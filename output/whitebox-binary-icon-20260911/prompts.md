# Whitebox binary icon refinement

Date: 2026-09-11
Method: built-in image_gen tool
Status: design candidates saved for review; application assets have not been replaced.

## Verification

- Both generated full-size images were visually inspected: the main icon has 01010, the small-size candidate has 01, each has a two-flap box and no star.
- Both PNG files decode through System.Drawing; all local preview file references exist.
- preview.html displays the unchanged PNG sources at 16, 20, 24, 32, 48 and 64 CSS pixels against light and dark backgrounds.
- Browser visual verification of those scaled views was blocked by the browser URL security policy denying the local file URL. No alternate browser route was attempted. Actual Windows taskbar/tray testing has not been performed, so 16px legibility is not claimed.

## Main icon — whitebox-main-01010.png

Use case: logo-brand. Edit target: the supplied Whitebox open-box-and-binary-speech-bubble icon. Create one refined final main application icon from this same concept, with a notably simpler box and a bigger speech bubble, designed to stay recognizable when reduced to 48 or 64 pixels.
Preserve the black and white visual identity and the exact digits "01010" (zero one zero one zero), no star.
Change the composition deliberately: enlarge the rounded speech bubble to about 62% of the canvas width, centered in the upper half with a short downward tail. Its five digits must be bold geometric monospaced black characters in one horizontal line, large enough to fill the bubble comfortably with clear white margins. Make the entire composition compact and centered rather than leaning far to one side. The bubble's bottom/tail should sit close above the open box with a clear small gap.
Simplify the lower box into a clean compact geometric open box: exactly TWO broad, simple open flaps, one left and one right, no extra front flap or small rear flap. White front/left face, solid near-black right face, simple dark interior. Eliminate overlapping outlines and fine internal edges. Thick smooth near-black outlines of consistent weight with lightly rounded joins. Box width about 64% of canvas, and box including flaps occupies roughly the lower 42% of the canvas. Keep enough separation that the speech bubble and box remain distinct in small sizes.
This is a minimal flat identity mark, not a detailed cardboard illustration. Use only solid white and solid near-black, no texture, no gradients, no grain, no lighting, no shadow, no 3D rendering. White background is one perfectly uniform opaque white square, edge to edge. Do NOT render a rounded-square tile, surrounding gray area, or any checkerboard. The source checkerboard must be removed entirely; it is not part of the design. The eventual OS can mask the square. Optical balance, generous negative space, large robust shapes, centered symbol occupies around 80% of square height. One square high-resolution icon, no captions or mockup, no star/sparkle, no added elements.

## Small icon — whitebox-tray-01.png

Use case: logo-brand. Edit target: the provided refined Whitebox app icon, a centered binary speech bubble above a simple two-flap open box. Create its matching SMALL-SIZE TRAY ICON variant intended for 16-32 pixel display. Preserve this exact visual identity and the same black and white two-flap box concept.
Replace the speech-bubble text with EXACTLY "01" (zero one), in one line. Make these two digits dramatically larger and heavier than in the input, approximately 28% of the full canvas height, bold simple geometric monospaced forms with a wide open counter in the zero, no slash inside the zero. The bubble should be centered, approximately 72% of canvas width and 45% of canvas height, with substantial 5%-of-canvas black outline and lightly rounded corners. White inner area. Short downward centered tail.
Below it retain the compact white-left-face / black-right-face open box with exactly two broad flaps, but simplify the tiny shapes and round joins. The box is about 67% of canvas width and 34% of canvas height including flaps. Align the center of the box with the bubble. Keep a small clear white gap between bubble tail and box opening. Use robust thick strokes and wide gaps that survive downscaling. This is a matching size-specific variant, not a different logo.
Uniform opaque white square background edge-to-edge, solid near-black shapes, absolutely flat vector-like artwork. No star, no sparkle, no dots, no extra digits, no extra letters, no gradient, no grain, no texture, no shadow, no checkerboard, no frame/tile around the icon. Balanced compact symbol with about 8% outer whitespace. Single square high-resolution icon, no presentation mockup.
