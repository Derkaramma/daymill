# Make your house picture

The house card looks best with a picture of *your* house. I made mine by
feeding a few photos of my house into ChatGPT and asking for a clean
"architectural render" of it, then a night version, then cutouts of our cars.
These are the exact prompts I used, with blanks for yours.

You don't need any of this to use SunFlow. With no picture, the card draws a
simple built-in house. This is the fun part you can do whenever.

## What you need

- ChatGPT or Gemini (anything that can make and edit images from your photos)
- A few photos of your house (see [house-day.md](house-day.md) for which ones)
- A top-down view of your roof. Google Maps or Google Earth satellite view is
  fine. This is how the tool gets your panel layout right.
- 20 to 40 minutes, mostly waiting and re-rolling

## Do it in this order

1. **[privacy.md](privacy.md)**: crop out your house number, street signs and
   license plates first. Takes two minutes.
2. **[house-day.md](house-day.md)**: the main daytime picture.
3. **[house-night.md](house-night.md)**: the same picture at night. Same chat.
4. **[car-cutout.md](car-cutout.md)**: one cutout per car, with a
   transparent background. Same chat.
5. **[battery-and-panel-edit.md](battery-and-panel-edit.md)** (optional): add
   your electrical panel, meter or battery to the wall.
6. **[fix-it.md](fix-it.md)**: when something comes out wrong. Something
   always comes out wrong.

[demo-house.md](demo-house.md) is how I made the made-up house you see in the
demo and screenshots.

**Keep everything in one chat.** The tool remembers the house, the camera and
the lighting, so the night picture and the cars come out matching. If you
start a new chat halfway through, things drift.

## What the card needs

| Picture | What it should be |
|---|---|
| Day house | Any size works. Landscape, about 16:10, looks best (1600x1000 or so). JPG or PNG. |
| Night house | Optional. Exact same framing and size as the day one. If you skip it, the card darkens the day picture at night. |
| Driveway | Empty. No cars, no people. Your cars get drawn on top as separate pictures, and they disappear when the car is away. |
| Car cutouts | PNG with a real transparent background. Rear 3/4 view, the same angle as the house camera, with the charge port side showing. About 800x500 or bigger, cropped tight. No ground shadow; the card adds its own. |
| Text | None anywhere. No house numbers, signs, logos, plates or labels. |

Why same framing matters: the card draws the glowing power lines on top of
the picture. If the night picture is shifted even a little, the lines float
off the house when the sun goes down.

If your charge port is on the other side of the car, that's fine. The editor
can flip the car picture.

## Putting the pictures in Home Assistant

The easy way is the house card editor: open the card, pick your day picture,
night picture and car cutouts, then drag the lines and cars into place. The
pictures get uploaded to your own Home Assistant.

You can also copy the files into `/config/www/sunflow/` and point the card at
them yourself:

```yaml
type: custom:sunflow-house-card
image_day: /local/sunflow/house-day.jpg
image_night: /local/sunflow/house-night.jpg
```

Heads up: anything in `/config/www` (and any uploaded picture link) can be
opened by anyone who has the link. That's one more reason to scrub house
numbers and plates first.
