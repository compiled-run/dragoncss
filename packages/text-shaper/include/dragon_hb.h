// dragon_hb: Dragon's shim over HarfBuzz at Chrome 145's pinned revision (see src/dragon_hb.zig).
// Only integers come back: per glyph, DHB_GLYPH_STRIDE int32 values
// {glyph id, cluster, x advance, y advance, x offset, y offset, glyph flags}, advances and offsets in 16.16.
#ifndef DRAGON_HB_H
#define DRAGON_HB_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DHB_GLYPH_STRIDE 7
#define DHB_GLYPH_FLAG_UNSAFE_TO_BREAK 0x1u

typedef struct dhb_face dhb_face;
typedef struct dhb_font dhb_font;
typedef struct dhb_shaper dhb_shaper;
typedef struct { uint32_t tag; uint32_t value; uint32_t start; uint32_t end; } dhb_feature;
typedef struct { uint32_t tag; float value; } dhb_variation;

dhb_face *dhb_face_create(const uint8_t *data, uint32_t length, uint32_t index);
void dhb_face_destroy(dhb_face *face);
uint32_t dhb_face_upem(const dhb_face *face);
uint32_t dhb_face_has_table(const dhb_face *face, uint32_t tag);
uint32_t dhb_face_feature_tags(const dhb_face *face, uint32_t table, uint32_t *out, uint32_t capacity);

dhb_font *dhb_font_create(dhb_face *face, float size, float specified_size, float weight, float width, float slope,
                          uint32_t optical_sizing_auto, const dhb_variation *settings, uint32_t settings_count);
void dhb_font_destroy(dhb_font *font);
int32_t dhb_font_glyph_advance(dhb_font *font, uint32_t glyph);
int32_t dhb_font_glyph_units(dhb_font *font, uint32_t glyph);
uint32_t dhb_font_glyph_extents(dhb_font *font, uint32_t glyph, int32_t out[4]);
uint32_t dhb_font_nominal_glyph(dhb_font *font, uint32_t codepoint);
// The normalized variation coordinates HarfBuzz uses (F2DOT14 after avar): writes up to capacity, returns the axis count.
uint32_t dhb_font_var_coords(dhb_font *font, int32_t *out, uint32_t capacity);

dhb_shaper *dhb_shaper_create(void);
void dhb_shaper_destroy(dhb_shaper *shaper);
uint32_t dhb_shape(dhb_shaper *shaper, dhb_font *font, const uint16_t *text, uint32_t text_length, uint32_t item_offset,
                   uint32_t item_length, uint32_t script, uint32_t direction, const char *language, uint32_t language_length,
                   const dhb_feature *features, uint32_t feature_count);
const int32_t *dhb_shaper_glyphs(dhb_shaper *shaper);

#ifdef __cplusplus
}
#endif

#endif
