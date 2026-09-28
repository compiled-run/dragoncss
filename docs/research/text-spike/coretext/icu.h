#include <stdint.h>
typedef uint16_t UChar; typedef int UErrorCode; typedef struct UBreakIterator UBreakIterator;
UBreakIterator* ubrk_open(int type, const char* locale, const UChar* text, int32_t textLength, UErrorCode* status);
int32_t ubrk_first(UBreakIterator* bi);
int32_t ubrk_next(UBreakIterator* bi);
void ubrk_close(UBreakIterator* bi);
