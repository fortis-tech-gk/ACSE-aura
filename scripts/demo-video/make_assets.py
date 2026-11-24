"""Makes fictional demo assets: passport-style photos + a fake UPI receipt. No real people."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')
os.makedirs(OUT, exist_ok=True)


def font(size, bold=False):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def portrait(name, bg, shirt, skin):
    im = Image.new('RGB', (413, 531), bg)  # 35x45 mm @ 300dpi ratio
    d = ImageDraw.Draw(im)
    d.ellipse((60, 380, 353, 700), fill=shirt)          # shoulders
    d.rectangle((175, 300, 238, 400), fill=skin)         # neck
    d.ellipse((120, 110, 293, 340), fill=skin)           # face
    d.pieslice((112, 90, 301, 280), 180, 360, fill=(30, 25, 25))  # hair
    d.ellipse((165, 205, 185, 222), fill=(40, 30, 30))
    d.ellipse((228, 205, 248, 222), fill=(40, 30, 30))
    d.arc((170, 245, 245, 295), 20, 160, fill=(120, 50, 50), width=4)
    im.save(os.path.join(OUT, name), quality=92)


portrait('athlete1.jpg', (226, 236, 249), (30, 64, 175), (222, 184, 150))
portrait('athlete2.jpg', (236, 244, 232), (22, 101, 52), (196, 152, 120))

r = Image.new('RGB', (720, 1000), (255, 255, 255))
d = ImageDraw.Draw(r)
d.rectangle((0, 0, 720, 150), fill=(88, 28, 135))
d.text((40, 45), 'Payment Successful', font=font(48, True), fill='white')
d.text((40, 220), 'To:  Dr. ACS College of Engineering', font=font(30), fill=(30, 30, 30))
d.text((40, 290), 'Remark:  DEMO-REGISTRATION', font=font(30), fill=(30, 30, 30))
d.text((40, 400), '₹ 500.00', font=font(90, True), fill=(22, 101, 52))
d.text((40, 560), 'Demo receipt - fictional, for the walkthrough video', font=font(26), fill=(120, 120, 120))
r.save(os.path.join(OUT, 'receipt.png'))
print('assets written to', OUT)
