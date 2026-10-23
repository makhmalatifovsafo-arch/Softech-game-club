using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace NetCafeClient.Services.Security;

/// <summary>
/// Standalone Standard QR Code (ISO/IEC 18004) Generator — Version 2 (25x25) / Version 3 (29x29)
/// Zero third-party dependencies. Generates authentic, standard-compliant scannable QR Codes
/// directly to WPF WriteableBitmap for instant 60 FPS rendering.
/// </summary>
public static class QrCodeGenerator
{
    // Galois Field 256 for QR Reed-Solomon error correction
    private static readonly byte[] ExpTable = new byte[512];
    private static readonly byte[] LogTable = new byte[256];

    static QrCodeGenerator()
    {
        int val = 1;
        for (int i = 0; i < 255; i++)
        {
            ExpTable[i] = (byte)val;
            ExpTable[i + 255] = (byte)val;
            LogTable[val] = (byte)i;
            val = (val << 1) ^ ((val & 0x80) != 0 ? 0x11D : 0);
        }
    }

    private static byte GfMultiply(byte a, byte b)
    {
        if (a == 0 || b == 0) return 0;
        return ExpTable[LogTable[a] + LogTable[b]];
    }

    private static byte[] GenerateEcPolynomial(int numEcWords)
    {
        byte[] poly = [1];
        for (int i = 0; i < numEcWords; i++)
        {
            byte[] next = new byte[poly.Length + 1];
            byte factor = ExpTable[i];
            for (int j = 0; j < poly.Length; j++)
            {
                next[j] ^= GfMultiply(poly[j], factor);
                next[j + 1] ^= poly[j];
            }
            poly = next;
        }
        return poly;
    }

    private static byte[] CalculateEcc(byte[] data, int numEcWords)
    {
        byte[] genPoly = GenerateEcPolynomial(numEcWords);
        byte[] remainder = new byte[numEcWords];

        foreach (byte d in data)
        {
            byte factor = (byte)(d ^ remainder[0]);
            for (int i = 0; i < numEcWords - 1; i++)
            {
                remainder[i] = (byte)(remainder[i + 1] ^ GfMultiply(genPoly[numEcWords - 1 - i], factor));
            }
            remainder[numEcWords - 1] = GfMultiply(genPoly[0], factor);
        }
        return remainder;
    }

    /// <summary>
    /// Generates a WriteableBitmap of size 200x200 representing the QR code for content.
    /// </summary>
    public static WriteableBitmap GenerateQrBitmap(string content, int targetSize = 200)
    {
        byte[] dataBytes = System.Text.Encoding.UTF8.GetBytes(content);
        
        // Choose QR version based on length
        // Version 2 (25x25): Total capacity 44 codewords (28 data + 16 EC words for Level M)
        // Version 3 (29x29): Total capacity 70 codewords (44 data + 26 EC words for Level M)
        int version = dataBytes.Length <= 24 ? 2 : 3;
        int size = 17 + 4 * version;
        int totalDataWords = version == 2 ? 28 : 44;
        int ecWords = version == 2 ? 16 : 26;

        // 1. Bitstream packaging: Byte Mode (0100) + Count (8 bits) + Data + Terminator (0000)
        List<bool> bits = [];
        void AppendBits(int val, int bitCount)
        {
            for (int i = bitCount - 1; i >= 0; i--)
                bits.Add(((val >> i) & 1) == 1);
        }

        AppendBits(0b0100, 4); // Byte Mode
        AppendBits(Math.Min(dataBytes.Length, totalDataWords - 2), 8); // Character count

        int maxContentBytes = Math.Min(dataBytes.Length, totalDataWords - 2);
        for (int i = 0; i < maxContentBytes; i++)
            AppendBits(dataBytes[i], 8);

        // Terminator
        int termLen = Math.Min(4, totalDataWords * 8 - bits.Count);
        AppendBits(0, termLen);

        // Pad to byte boundary
        while (bits.Count % 8 != 0)
            bits.Add(false);

        // Pad codewords up to totalDataWords
        byte[] padBytes = [0xEC, 0x11];
        int padIdx = 0;
        while (bits.Count < totalDataWords * 8)
        {
            AppendBits(padBytes[padIdx % 2], 8);
            padIdx++;
        }

        // Convert bits to data codewords
        byte[] dataCodewords = new byte[totalDataWords];
        for (int i = 0; i < totalDataWords; i++)
        {
            byte b = 0;
            for (int bit = 0; bit < 8; bit++)
                if (bits[i * 8 + bit]) b |= (byte)(1 << (7 - bit));
            dataCodewords[i] = b;
        }

        // Calculate EC Codewords
        byte[] ecCodewords = CalculateEcc(dataCodewords, ecWords);

        // Combine into final stream
        byte[] allCodewords = new byte[totalDataWords + ecWords];
        Array.Copy(dataCodewords, 0, allCodewords, 0, totalDataWords);
        Array.Copy(ecCodewords, 0, allCodewords, totalDataWords, ecWords);

        // 2. Build 2D Matrix (true = black, false = white)
        bool[,] matrix = new bool[size, size];
        bool[,] reserved = new bool[size, size];

        // Finder Patterns (7x7) + Separators
        void PlaceFinder(int r, int c)
        {
            for (int y = -1; y <= 7; y++)
            {
                for (int x = -1; x <= 7; x++)
                {
                    int pr = r + y;
                    int pc = c + x;
                    if (pr >= 0 && pr < size && pc >= 0 && pc < size)
                    {
                        reserved[pr, pc] = true;
                        bool isBlack = (y >= 0 && y <= 6 && (x == 0 || x == 6)) ||
                                       (x >= 0 && x <= 6 && (y == 0 || y == 6)) ||
                                       (y >= 2 && y <= 4 && x >= 2 && x <= 4);
                        matrix[pr, pc] = isBlack;
                    }
                }
            }
        }

        PlaceFinder(0, 0);
        PlaceFinder(0, size - 7);
        PlaceFinder(size - 7, 0);

        // Timing Patterns
        for (int i = 8; i < size - 8; i++)
        {
            if (!reserved[6, i]) { matrix[6, i] = (i % 2 == 0); reserved[6, i] = true; }
            if (!reserved[i, 6]) { matrix[i, 6] = (i % 2 == 0); reserved[i, 6] = true; }
        }

        // Alignment Pattern for Version 2 & 3
        int alignPos = version == 2 ? 18 : 22;
        if (version >= 2)
        {
            for (int y = -2; y <= 2; y++)
            {
                for (int x = -2; x <= 2; x++)
                {
                    int ar = alignPos + y;
                    int ac = alignPos + x;
                    if (!reserved[ar, ac])
                    {
                        reserved[ar, ac] = true;
                        matrix[ar, ac] = (Math.Abs(x) == 2 || Math.Abs(y) == 2 || (x == 0 && y == 0));
                    }
                }
            }
        }

        // Reserve Format info space around finders
        for (int i = 0; i < 9; i++)
        {
            if (i < size) { reserved[8, i] = true; reserved[i, 8] = true; }
            if (size - 1 - i < size) { reserved[8, size - 1 - i] = true; reserved[size - 1 - i, 8] = true; }
        }
        reserved[size - 8, 8] = true; // Dark module

        // 3. Place Data Bits in zigzag pattern
        List<bool> finalBits = [];
        foreach (byte b in allCodewords)
        {
            for (int bit = 7; bit >= 0; bit--)
                finalBits.Add(((b >> bit) & 1) == 1);
        }

        int bitIndex = 0;
        int row = size - 1;
        int dir = -1; // up = -1, down = 1

        for (int col = size - 1; col > 0; col -= 2)
        {
            if (col == 6) col--; // Skip vertical timing line

            while (true)
            {
                for (int c = 0; c < 2; c++)
                {
                    int curCol = col - c;
                    if (!reserved[row, curCol])
                    {
                        bool bitVal = bitIndex < finalBits.Count && finalBits[bitIndex++];
                        // Apply Mask Pattern 0: (row + col) % 2 == 0
                        if ((row + curCol) % 2 == 0) bitVal = !bitVal;
                        matrix[row, curCol] = bitVal;
                    }
                }

                row += dir;
                if (row < 0 || row >= size)
                {
                    dir = -dir;
                    row += dir;
                    break;
                }
            }
        }

        // 4. Format Information (Level M = 00, Mask 0 = 000 -> 00000 -> Format Bits with BCH: 101010000010010)
        int formatBits = 0b101010000010010;
        int[] fRows = [0, 1, 2, 3, 4, 5, 7, 8, size - 7, size - 6, size - 5, size - 4, size - 3, size - 2, size - 1];
        int[] fCols = [size - 1, size - 2, size - 3, size - 4, size - 5, size - 6, size - 7, size - 8, 8, 7, 5, 4, 3, 2, 1, 0];

        for (int i = 0; i < 15; i++)
        {
            bool bit = ((formatBits >> (14 - i)) & 1) == 1;
            // Top-left
            if (i < 6) matrix[i, 8] = bit;
            else if (i == 6) matrix[7, 8] = bit;
            else if (i == 7) matrix[8, 8] = bit;
            else if (i == 8) matrix[8, 7] = bit;
            else matrix[8, 14 - i] = bit;

            // Split across other finders
            if (i < 8) matrix[8, size - 1 - i] = bit;
            else matrix[size - 15 + i, 8] = bit;
        }

        // Dark module
        matrix[size - 8, 8] = true;

        // 5. Render to high-resolution WriteableBitmap (with 2-module quiet zone)
        int quiet = 2;
        int fullSize = size + quiet * 2;
        int scale = Math.Max(1, targetSize / fullSize);
        int bmpDim = fullSize * scale;

        WriteableBitmap wbmp = new WriteableBitmap(bmpDim, bmpDim, 96, 96, PixelFormats.Bgr32, null);
        int stride = bmpDim * 4;
        byte[] pixels = new byte[stride * bmpDim];

        // Background white
        for (int i = 0; i < pixels.Length; i += 4)
        {
            pixels[i] = 255;
            pixels[i + 1] = 255;
            pixels[i + 2] = 255;
            pixels[i + 3] = 255;
        }

        // Modules black
        for (int r = 0; r < size; r++)
        {
            for (int c = 0; c < size; c++)
            {
                if (matrix[r, c])
                {
                    int startX = (c + quiet) * scale;
                    int startY = (r + quiet) * scale;
                    for (int py = 0; py < scale; py++)
                    {
                        for (int px = 0; px < scale; px++)
                        {
                            int offset = ((startY + py) * bmpDim + (startX + px)) * 4;
                            if (offset + 3 < pixels.Length)
                            {
                                pixels[offset] = 12;     // B
                                pixels[offset + 1] = 12; // G
                                pixels[offset + 2] = 18; // R
                                pixels[offset + 3] = 255;
                            }
                        }
                    }
                }
            }
        }

        wbmp.WritePixels(new Int32Rect(0, 0, bmpDim, bmpDim), pixels, stride, 0);
        wbmp.Freeze();
        return wbmp;
    }
}
