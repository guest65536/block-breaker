# アプリアイコン生成(ブロックくずし・高コントラスト)
from PIL import Image, ImageDraw

BG = (16, 20, 28)          # #10141C
ACCENT = (0, 229, 255)     # 水色(バー)
ROWS = [
    [(0, 229, 255), (213, 0, 249), (255, 214, 0), (0, 230, 118)],   # 水・紫・黄・緑
    [(255, 145, 0), (255, 61, 0), (41, 121, 255), (213, 0, 249)],   # 橙・赤・青・紫
]

def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

def make(size, maskable=False):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, size, size], fill=BG)
        m = size * 0.20
    else:
        rounded(d, [0, 0, size, size], int(size * 0.22), BG)
        m = size * 0.16

    area = size - m * 2
    # --- ブロック(上部2段) ---
    cols = 4
    gap = area * 0.03
    bw = (area - gap * (cols - 1)) / cols
    bh = area * 0.13
    top = m + area * 0.06
    for r, row in enumerate(ROWS):
        y = top + r * (bh + gap)
        for c, color in enumerate(row):
            x = m + c * (bw + gap)
            d.rounded_rectangle([x, y, x + bw, y + bh], radius=int(bh * 0.18), fill=color)
            # 上のハイライト
            hl = tuple(min(255, int(v + (255 - v) * 0.35)) for v in color)
            d.rectangle([x + 2, y + 2, x + bw - 2, y + bh * 0.28], fill=hl)

    # --- ボール(中央やや下) ---
    ball_r = area * 0.09
    bx = m + area * 0.5
    by = m + area * 0.62
    d.ellipse([bx - ball_r, by - ball_r, bx + ball_r, by + ball_r], fill=(255, 255, 255))

    # --- バー(下部) ---
    pw = area * 0.42
    phh = area * 0.06
    px = m + area * 0.5
    py = m + area * 0.9
    d.rounded_rectangle([px - pw / 2, py - phh / 2, px + pw / 2, py + phh / 2],
                        radius=int(phh / 2), fill=ACCENT)
    return img

make(192).save('icon-192.png')
make(512).save('icon-512.png')
make(512, maskable=True).save('icon-maskable-512.png')
make(180).save('apple-touch-icon.png')
print('icons generated')
