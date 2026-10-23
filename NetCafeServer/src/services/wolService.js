import dgram from 'node:dgram';

/**
 * Wake-on-LAN (WoL) Magic Packet yuborish
 * Standart WoL Magic Packet: 6 bayt 0xFF va ketidan maqsadli MAC manzilining 16 marta takrorlanishi (Jami 102 bayt).
 * Tarmoq broadcast manziliga (default: 255.255.255.255, port: 9 va 7) UDP orqali uzatiladi.
 * 
 * @param {string} macAddress - Kompyuterning MAC manzili (masalan: "00:1A:2B:3C:4D:5E" yoki "001A2B3C4D5E")
 * @param {string} broadcastIp - Broadcast IP manzili (default: "255.255.255.255")
 * @param {number} port - UDP port (default: 9)
 * @returns {Promise<{ success: boolean, macAddress: string, bytesSent: number }>}
 */
export function sendWakeOnLan(macAddress, broadcastIp = '255.255.255.255', port = 9) {
  return new Promise((resolve, reject) => {
    if (!macAddress || typeof macAddress !== 'string') {
      return reject(new Error('Kompyuterning MAC manzili ko\'rsatilmagan.'));
    }

    // 1. MAC manzilni tozalash (faqat hex belgilar: 0-9, A-F)
    const cleanMac = macAddress.replace(/[^0-9A-Fa-f]/g, '');
    if (cleanMac.length !== 12) {
      return reject(new Error(`Noto'g'ri MAC manzil formati: "${macAddress}". 12 ta hex belgi bo'lishi kerak.`));
    }

    // 2. 6 baytli MAC buferi yaratish
    const macBytes = Buffer.alloc(6);
    for (let i = 0; i < 6; i++) {
      macBytes[i] = parseInt(cleanMac.substring(i * 2, i * 2 + 2), 16);
    }

    // 3. 102 baytli Magic Packet buferini tayyorlash: 6x 0xFF + 16x MAC
    const magicPacket = Buffer.alloc(102);
    magicPacket.fill(0xff, 0, 6);
    for (let i = 0; i < 16; i++) {
      macBytes.copy(magicPacket, 6 + i * 6, 0, 6);
    }

    // 4. UDP broadcast soket ochish
    const client = dgram.createSocket('udp4');

    client.once('error', (err) => {
      try { client.close(); } catch {}
      reject(new Error(`WoL soket xatosi: ${err.message}`));
    });

    client.bind(0, () => {
      client.setBroadcast(true);

      // Port 9 ga jo'natish
      client.send(magicPacket, 0, magicPacket.length, port, broadcastIp, (err) => {
        // Shuningdek, ba'zi marshrutizatorlar uchun Port 7 ga ham yuborish
        client.send(magicPacket, 0, magicPacket.length, 7, broadcastIp, () => {
          try { client.close(); } catch {}
          if (err) {
            return reject(new Error(`WoL paket yuborishda xatolik: ${err.message}`));
          }
          console.log(`⚡ [WoL] Magic Packet muvaffaqiyatli jo'natildi: MAC ${macAddress} -> ${broadcastIp}:${port}`);
          resolve({
            success: true,
            macAddress,
            bytesSent: magicPacket.length
          });
        });
      });
    });
  });
}
