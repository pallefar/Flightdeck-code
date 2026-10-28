import { z } from "../../../../vendor/zod/v4/index.js";
/**
 * True only for an href the renderer may emit:
 * - `https:` with a host;
 * - `mailto:` with an address;
 * - a same-origin path starting with exactly one '/'.
 * Refused: every other scheme (javascript:, data:, http:, vbscript: ...), a
 * protocol-relative '//host', any backslash (browsers read '\' as '/'), any
 * whitespace or control character, and a relative path.
 */
export declare function isSafeHref(href: unknown): boolean;
export declare const hrefSchema: z.ZodString;
export declare const textRunSchema: z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
    marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"bold">;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"italic">;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"code">;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"link">;
        href: z.ZodString;
    }, z.core.$strict>]>>>;
}, z.core.$strict>;
export type TextRun = z.infer<typeof textRunSchema>;
export declare const richNodeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"paragraph">;
    content: z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"bold">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"italic">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"code">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"link">;
            href: z.ZodString;
        }, z.core.$strict>]>>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"heading">;
    level: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>]>;
    content: z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"bold">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"italic">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"code">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"link">;
            href: z.ZodString;
        }, z.core.$strict>]>>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"bulletList">;
    items: z.ZodArray<z.ZodObject<{
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"bold">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"italic">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"code">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"link">;
                href: z.ZodString;
            }, z.core.$strict>]>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"orderedList">;
    items: z.ZodArray<z.ZodObject<{
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"bold">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"italic">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"code">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"link">;
                href: z.ZodString;
            }, z.core.$strict>]>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>]>;
export type RichNode = z.infer<typeof richNodeSchema>;
/** One locale's rich text: a list of top-level nodes. */
export declare const richTextSchema: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"paragraph">;
    content: z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"bold">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"italic">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"code">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"link">;
            href: z.ZodString;
        }, z.core.$strict>]>>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"heading">;
    level: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>]>;
    content: z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"bold">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"italic">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"code">;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"link">;
            href: z.ZodString;
        }, z.core.$strict>]>>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"bulletList">;
    items: z.ZodArray<z.ZodObject<{
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"bold">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"italic">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"code">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"link">;
                href: z.ZodString;
            }, z.core.$strict>]>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"orderedList">;
    items: z.ZodArray<z.ZodObject<{
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"bold">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"italic">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"code">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"link">;
                href: z.ZodString;
            }, z.core.$strict>]>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>]>>;
export type RichText = z.infer<typeof richTextSchema>;
export declare const localizedRich: z.ZodObject<{
    en: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"paragraph">;
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"bold">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"italic">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"code">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"link">;
                href: z.ZodString;
            }, z.core.$strict>]>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"heading">;
        level: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>]>;
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"bold">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"italic">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"code">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"link">;
                href: z.ZodString;
            }, z.core.$strict>]>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"bulletList">;
        items: z.ZodArray<z.ZodObject<{
            content: z.ZodArray<z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"bold">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"italic">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"orderedList">;
        items: z.ZodArray<z.ZodObject<{
            content: z.ZodArray<z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"bold">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"italic">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>]>>>;
    de: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"paragraph">;
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"bold">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"italic">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"code">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"link">;
                href: z.ZodString;
            }, z.core.$strict>]>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"heading">;
        level: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>]>;
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"bold">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"italic">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"code">;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"link">;
                href: z.ZodString;
            }, z.core.$strict>]>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"bulletList">;
        items: z.ZodArray<z.ZodObject<{
            content: z.ZodArray<z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"bold">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"italic">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"orderedList">;
        items: z.ZodArray<z.ZodObject<{
            content: z.ZodArray<z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                marks: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"bold">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"italic">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"code">;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"link">;
                    href: z.ZodString;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>]>>>;
    basis: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
