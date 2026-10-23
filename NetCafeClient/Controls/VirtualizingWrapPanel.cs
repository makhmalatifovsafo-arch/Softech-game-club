using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

using Size = System.Windows.Size;
using Point = System.Windows.Point;
using Rect = System.Windows.Rect;

namespace NetCafeClient.Controls;

/// <summary>
/// VirtualizingWrapPanel — 100+ o'yinlar ro'yxatida ham 60 FPS tezlikni ta'minlovchi
/// to'liq virtualizatsiyalangan WrapPanel.
/// Faqat ekranda ko'rinib turgan kartochkalarni xotirada yaratadi va off-screen bo'lganlarini tozalaydi.
/// </summary>
public class VirtualizingWrapPanel : VirtualizingPanel, IScrollInfo
{
    public static readonly DependencyProperty ItemWidthProperty =
        DependencyProperty.Register(nameof(ItemWidth), typeof(double), typeof(VirtualizingWrapPanel),
            new FrameworkPropertyMetadata(220.0, FrameworkPropertyMetadataOptions.AffectsMeasure));

    public static readonly DependencyProperty ItemHeightProperty =
        DependencyProperty.Register(nameof(ItemHeight), typeof(double), typeof(VirtualizingWrapPanel),
            new FrameworkPropertyMetadata(320.0, FrameworkPropertyMetadataOptions.AffectsMeasure));

    public double ItemWidth
    {
        get => (double)GetValue(ItemWidthProperty);
        set => SetValue(ItemWidthProperty, value);
    }

    public double ItemHeight
    {
        get => (double)GetValue(ItemHeightProperty);
        set => SetValue(ItemHeightProperty, value);
    }

    private ScrollViewer? _scrollOwner;
    private bool _canHorizontallyScroll = false;
    private bool _canVerticallyScroll = false;
    private Size _extent = new(0, 0);
    private Size _viewport = new(0, 0);
    private Point _offset = new(0, 0);

    // =========================================================================
    // IScrollInfo Implementation
    // =========================================================================
    public bool CanHorizontallyScroll
    {
        get => _canHorizontallyScroll;
        set => _canHorizontallyScroll = value;
    }

    public bool CanVerticallyScroll
    {
        get => _canVerticallyScroll;
        set => _canVerticallyScroll = value;
    }

    public double ExtentWidth => _extent.Width;
    public double ExtentHeight => _extent.Height;
    public double ViewportWidth => _viewport.Width;
    public double ViewportHeight => _viewport.Height;
    public double HorizontalOffset => _offset.X;
    public double VerticalOffset => _offset.Y;
    public ScrollViewer? ScrollOwner
    {
        get => _scrollOwner;
        set => _scrollOwner = value;
    }

    public void LineUp() => SetVerticalOffset(_offset.Y - 48);
    public void LineDown() => SetVerticalOffset(_offset.Y + 48);
    public void LineLeft() => SetHorizontalOffset(_offset.X - 48);
    public void LineRight() => SetHorizontalOffset(_offset.X + 48);

    public void PageUp() => SetVerticalOffset(_offset.Y - _viewport.Height);
    public void PageDown() => SetVerticalOffset(_offset.Y + _viewport.Height);
    public void PageLeft() => SetHorizontalOffset(_offset.X - _viewport.Width);
    public void PageRight() => SetHorizontalOffset(_offset.X + _viewport.Width);

    public void MouseWheelUp() => SetVerticalOffset(_offset.Y - 72);
    public void MouseWheelDown() => SetVerticalOffset(_offset.Y + 72);
    public void MouseWheelLeft() => SetHorizontalOffset(_offset.X - 72);
    public void MouseWheelRight() => SetHorizontalOffset(_offset.X + 72);

    public void SetHorizontalOffset(double offset)
    {
        if (offset < 0 || _viewport.Width >= _extent.Width) offset = 0;
        else if (offset + _viewport.Width > _extent.Width) offset = _extent.Width - _viewport.Width;

        _offset.X = offset;
        _scrollOwner?.InvalidateScrollInfo();
        InvalidateMeasure();
    }

    public void SetVerticalOffset(double offset)
    {
        if (offset < 0 || _viewport.Height >= _extent.Height) offset = 0;
        else if (offset + _viewport.Height > _extent.Height) offset = _extent.Height - _viewport.Height;

        _offset.Y = offset;
        _scrollOwner?.InvalidateScrollInfo();
        InvalidateMeasure();
    }

    public Rect MakeVisible(Visual visual, Rect rectangle) => rectangle;

    // =========================================================================
    // Measurement & Virtualization Engine
    // =========================================================================
    protected override Size MeasureOverride(Size availableSize)
    {
        var itemsControl = ItemsControl.GetItemsOwner(this);
        int itemCount = itemsControl?.Items.Count ?? 0;

        if (itemCount == 0 || availableSize.Width <= 0)
        {
            _extent = new Size(0, 0);
            _viewport = availableSize;
            _scrollOwner?.InvalidateScrollInfo();
            return new Size(0, 0);
        }

        double width = double.IsInfinity(availableSize.Width) ? 1200 : availableSize.Width;
        double itemW = Math.Max(100, ItemWidth);
        double itemH = Math.Max(100, ItemHeight);

        int itemsPerRow = Math.Max(1, (int)(width / itemW));
        int totalRows = (itemCount + itemsPerRow - 1) / itemsPerRow;

        double totalHeight = totalRows * itemH;
        _extent = new Size(width, totalHeight);
        _viewport = new Size(width, double.IsInfinity(availableSize.Height) ? totalHeight : availableSize.Height);

        _scrollOwner?.InvalidateScrollInfo();

        // Ko'rinadigan oraliqni hisoblash
        int firstRow = Math.Max(0, (int)(_offset.Y / itemH));
        int lastRow = Math.Min(totalRows - 1, (int)((_offset.Y + _viewport.Height) / itemH) + 1);

        int firstIndex = Math.Max(0, firstRow * itemsPerRow);
        int lastIndex = Math.Min(itemCount - 1, (lastRow + 1) * itemsPerRow - 1);

        var generator = ItemContainerGenerator;
        if (generator == null) return availableSize;

        GeneratorPosition startPos = generator.GeneratorPositionFromIndex(firstIndex);
        int childIndex = (startPos.Offset == 0) ? startPos.Index : startPos.Index + 1;

        using (generator.StartAt(startPos, GeneratorDirection.Forward, true))
        {
            for (int i = firstIndex; i <= lastIndex; i++)
            {
                var child = (UIElement)generator.GenerateNext(out bool isNewlyRealized);
                if (isNewlyRealized)
                {
                    if (childIndex >= InternalChildren.Count)
                        AddInternalChild(child);
                    else
                        InsertInternalChild(childIndex, child);

                    generator.PrepareItemContainer(child);
                }
                child.Measure(new Size(itemW, itemH));
                childIndex++;
            }
        }

        // Ko'rinmaydigan konteynerlarni xotiradan tozalash (Recycle / Remove)
        CleanUpItems(firstIndex, lastIndex);

        return new Size(width, Math.Min(totalHeight, _viewport.Height));
    }

    private void CleanUpItems(int minDesiredIndex, int maxDesiredIndex)
    {
        var generator = ItemContainerGenerator;
        if (generator == null) return;

        for (int i = InternalChildren.Count - 1; i >= 0; i--)
        {
            var childPos = new GeneratorPosition(i, 0);
            int itemIndex = generator.IndexFromGeneratorPosition(childPos);
            if (itemIndex < minDesiredIndex || itemIndex > maxDesiredIndex)
            {
                generator.Remove(childPos, 1);
                RemoveInternalChildRange(i, 1);
            }
        }
    }

    protected override Size ArrangeOverride(Size finalSize)
    {
        var itemsControl = ItemsControl.GetItemsOwner(this);
        int itemCount = itemsControl?.Items.Count ?? 0;
        if (itemCount == 0 || finalSize.Width <= 0) return finalSize;

        double itemW = Math.Max(100, ItemWidth);
        double itemH = Math.Max(100, ItemHeight);
        int itemsPerRow = Math.Max(1, (int)(finalSize.Width / itemW));

        // Markazlashtirish uchun chetki bo'shliq (horizontal padding)
        double totalRowWidth = itemsPerRow * itemW;
        double sideOffset = Math.Max(0, (finalSize.Width - totalRowWidth) / 2);

        var generator = ItemContainerGenerator;
        if (generator == null) return finalSize;

        for (int i = 0; i < InternalChildren.Count; i++)
        {
            var child = InternalChildren[i];
            int itemIndex = generator.IndexFromGeneratorPosition(new GeneratorPosition(i, 0));
            if (itemIndex < 0) continue;

            int row = itemIndex / itemsPerRow;
            int col = itemIndex % itemsPerRow;

            double x = sideOffset + (col * itemW);
            double y = (row * itemH) - _offset.Y;

            child.Arrange(new Rect(x, y, itemW, itemH));
        }

        return finalSize;
    }
}
