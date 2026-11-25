# Step 3: car cutouts

Each car is its own picture with a transparent background. The card puts it
on the driveway when the car is home, runs a charging cable to it, and hides
it when the car is away. That's why the house picture needs an empty driveway.

Stay in the same chat as the house so the lighting and angle match. Do one car
at a time.

## What a good cutout looks like

- **Rear 3/4 view.** Parked nose-in, facing the garage, so you see the back of
  the car and one side.
- **Same camera height as the house.** Looking down from about 2 stories up.
  A car shot from eye level looks pasted on.
- **Charge port side showing.** The cable ends at the port. If your port is
  on the side you can't see, flip the picture in the editor instead.
- **Real transparency.** A PNG where the background is actually see-through,
  not white and not a gray checkerboard (more on that below).
- **No ground shadow, no floor, no reflection.** The card adds a soft shadow.
- Cropped tight with the whole car in frame. About 800x500 or bigger.

## The prompt

You can describe your actual car, or ask for a generic one. If you name the
make and model it'll usually put the badges on. That's fine for your own
dashboard, just don't post it publicly if you care.

```text
Create a photorealistic image of a [year / color / make and model, OR "a
generic modern electric sedan / SUV / pickup with no badges or logos"] seen
from the REAR 3/4 view, from an elevated angle about 2 stories high, matching
the camera of the house render, as if it's parked nose-in on the driveway
facing the garage. We see the rear and the [left / right] side. The charge port
on the [rear-left / front-left fender / rear-right / ...] is visible.

Soft daylight matching the house render. The car is isolated on a fully
TRANSPARENT background (PNG with alpha), with no ground, no shadow, no
reflection floor and no other objects. Tightly framed, whole car visible.
No license plate (leave it blank), no people, no text.
```

Second car, same chat:

```text
Same camera angle, lighting and framing, now a [car 2]. Transparent
background, no ground, no shadow, no plate, no text.
```

You don't need night versions. The card dims the cars at night on its own.

## Is the background really transparent?

A lot of the time it isn't. The tool draws a checkerboard pattern that *looks*
like transparency, or quietly gives you a white background. Check it:

- Open the PNG on a dark background (Preview on a Mac, or drop it into a
  dark-mode chat or doc). If you see white or a checkerboard, it's fake.

Fixes, easiest first:

1. Ask: "The background is not transparent. Output the same car on a truly
   transparent background, PNG with alpha."
2. Use a background remover on what you've got:
   - Mac: open it in Preview, then Tools > Remove Background, then export
     as PNG. Or right-click it in Finder > Quick Actions > Remove Background.
   - iPhone/iPad: open the photo, touch and hold the car, then Copy or Share.
   - Windows: Paint and the Photos app both have a remove background button.
   - remove.bg in a browser works too.
3. Check again on a dark background. Clean up any leftover halo with an
   eraser if you're picky.

Save them as something like `car-1.png` and `car-2.png`.

Next (optional): [battery-and-panel-edit.md](battery-and-panel-edit.md)
