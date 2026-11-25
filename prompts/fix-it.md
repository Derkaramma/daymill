# When it comes out wrong

It will. Every one of these happened to me. Paste the fix into the **same
chat** so it keeps the house it already made. If a fix makes things worse,
scroll up and re-run from the last good version instead of piling on more
fixes.

General tip: always start a fix with "Keep everything identical, but..." and
end with "Do not move the camera." Otherwise it redraws the whole scene.

## It looks flat, like a straight-on photo

```text
Keep the house the same, but change the view to an elevated 3/4 aerial angle:
camera about 2 stories up at the front-[left/right] corner of the lot, looking
down about 25 degrees, so we see the front and the [left/right] side of the
house and the roof slopes. Landscape 16:10.
```

## Wrong angle or wrong side

```text
Keep everything identical, but the camera is on the wrong side. Move it to the
front-[left/right] corner so the [garage] is nearest, on the [left/right].
Same height, same 25 degree tilt.
```

If it keeps mirroring things, attach your corner photo again and say "match
the angle of this photo."

## It made stuff up

Extra windows, a chimney, dormers, a second garage door, a porch you don't
have, a pool.

```text
Keep everything identical, but remove the [chimney / extra window on the right
wing / second garage door]. My house does not have [it]. The roof is
[hip/gable], not [what it drew]. Do not add anything that isn't in my photos.
Do not move the camera.
```

Name each thing. "Make it more accurate" doesn't do much.

## Wrong number of solar panels

The most common one. Attach the top-down roof view again.

```text
Keep everything identical but fix the solar panels. There are exactly [N]
panels: [N1] on the [which] slope in [rows x columns], and [N2] on the [which]
slope in [layout]. No panels on [section]. Match the attached top-down view.
Do not move the camera.
```

If it still miscounts after two tries, describe one roof slope at a time.

## Night version doesn't line up

The house shifted, zoomed, or the picture came out a different size.

```text
The house shifted. Redo the night image with framing identical to the day
image: same camera, same crop, same size, every roof edge and the driveway in
exactly the same pixel position. Only the lighting changes.
```

Still off? Attach the day picture and say "Edit this exact image to make it
night" instead. Editing keeps the framing better than making a new one.

Last resort: skip the night picture. The card darkens the day one at night.

## Fake transparency on a car

You see a white background or a gray checkerboard.

```text
The background is not transparent. Output the same car on a truly transparent
background, PNG with alpha. No checkerboard, no white, no floor, no shadow.
```

If it can't, use a background remover. See [car-cutout.md](car-cutout.md).

## Car is at the wrong angle

```text
Rotate the view so it matches the house camera: we should see the rear and the
[left/right] side, nose pointing away from us, looking down from about 2
stories up.
```

## Text, numbers or logos snuck in

```text
Remove all text, numbers, signs and logos from the image. Change nothing else.
```

Zoom in on the garage, the mailbox, the curb and the car bumpers. House
numbers love to show up on curbs.

## Wrong shape or too small

```text
Output the same image at 16:10 landscape, at least 1600 pixels wide. Change
nothing else.
```

The card handles any size, so this is about looks, not about breaking anything.
