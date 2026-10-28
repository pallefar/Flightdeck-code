import { z } from "../../../../vendor/zod/v4/index.js";
/** A focal point, as fractions of the width and height (0,0 = top left). */
export declare const focalSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
}, z.core.$strict>;
/** Caption tracks for a video, one library file per language. */
export declare const captionTracksSchema: z.ZodObject<{
    en: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>>;
    de: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const MEDIA_KINDS: readonly ["image", "video"];
export declare const mediaBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"media">;
    kind: z.ZodEnum<{
        video: "video";
        image: "image";
    }>;
    mediaRef: z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>;
    alt: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    decorative: z.ZodOptional<z.ZodLiteral<true>>;
    caption: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    focal: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strict>>;
    posterRef: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>>;
    captions: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>>;
        de: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const galleryItemSchema: z.ZodObject<{
    id: z.ZodString;
    mediaRef: z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>;
    alt: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    decorative: z.ZodOptional<z.ZodLiteral<true>>;
    caption: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const galleryBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"gallery">;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        mediaRef: z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
        caption: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const featureItemSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    text: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    media: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const featureGridBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"featureGrid">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        text: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        media: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const benefitItemSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    text: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const benefitsBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"benefits">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        text: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const faqItemSchema: z.ZodObject<{
    id: z.ZodString;
    q: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    a: z.ZodObject<{
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
}, z.core.$strict>;
export declare const faqBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"faq">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        q: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        a: z.ZodObject<{
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
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ctaBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"cta">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    text: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    label: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    style: z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
    }>;
    action: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"openApp">;
        appId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"requestAccess">;
        appId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"openPage">;
        pageId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"openUrl">;
        url: z.ZodString;
    }, z.core.$strict>]>;
}, z.core.$strict>;
/** Either named apps (in this order) or every app the reader may see. */
export declare const appCardsBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"appCards">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
}, z.core.$strict>;
/** A live widget slot. The config is bounded plain data; the widget itself
 * is checked by the host's widget containment before it renders. */
export declare const widgetBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"widget">;
    widgetId: z.ZodString;
    config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
}, z.core.$strict>;
/** Every block that may sit inside a tab: all of them except tabs. */
export declare const nonTabsBlockSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"hero">;
    heading: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    subheading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    media: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
    }, z.core.$strict>>;
    cta: z.ZodOptional<z.ZodObject<{
        label: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        style: z.ZodEnum<{
            primary: "primary";
            secondary: "secondary";
        }>;
        action: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"openApp">;
            appId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"requestAccess">;
            appId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"openPage">;
            pageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"openUrl">;
            url: z.ZodString;
        }, z.core.$strict>]>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"richText">;
    content: z.ZodObject<{
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
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"divider">;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"media">;
    kind: z.ZodEnum<{
        video: "video";
        image: "image";
    }>;
    mediaRef: z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>;
    alt: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    decorative: z.ZodOptional<z.ZodLiteral<true>>;
    caption: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    focal: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strict>>;
    posterRef: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>>;
    captions: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>>;
        de: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"gallery">;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        mediaRef: z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
        caption: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"featureGrid">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        text: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        media: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"benefits">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        text: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"faq">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        q: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        a: z.ZodObject<{
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
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"cta">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    text: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    label: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    style: z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
    }>;
    action: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"openApp">;
        appId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"requestAccess">;
        appId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"openPage">;
        pageId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"openUrl">;
        url: z.ZodString;
    }, z.core.$strict>]>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"appCards">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"widget">;
    widgetId: z.ZodString;
    config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
}, z.core.$strict>]>;
export declare const tabSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"hero">;
        heading: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        subheading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        media: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
        }, z.core.$strict>>;
        cta: z.ZodOptional<z.ZodObject<{
            label: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            style: z.ZodEnum<{
                primary: "primary";
                secondary: "secondary";
            }>;
            action: z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"openApp">;
                appId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"requestAccess">;
                appId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"openPage">;
                pageId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"openUrl">;
                url: z.ZodString;
            }, z.core.$strict>]>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"richText">;
        content: z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"divider">;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"media">;
        kind: z.ZodEnum<{
            video: "video";
            image: "image";
        }>;
        mediaRef: z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
        caption: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        focal: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strict>>;
        posterRef: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>>;
        captions: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>>;
            de: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"gallery">;
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            mediaRef: z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
            caption: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"featureGrid">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            text: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            media: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
                alt: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                decorative: z.ZodOptional<z.ZodLiteral<true>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"benefits">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            text: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"faq">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        items: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            q: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            a: z.ZodObject<{
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
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"cta">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        text: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        label: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        style: z.ZodEnum<{
            primary: "primary";
            secondary: "secondary";
        }>;
        action: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"openApp">;
            appId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"requestAccess">;
            appId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"openPage">;
            pageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"openUrl">;
            url: z.ZodString;
        }, z.core.$strict>]>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"appCards">;
        heading: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"widget">;
        widgetId: z.ZodString;
        config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export type Tab = z.infer<typeof tabSchema>;
export declare const tabsBlockSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"tabs">;
    tabs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"hero">;
            heading: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            subheading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            media: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
                alt: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                decorative: z.ZodOptional<z.ZodLiteral<true>>;
            }, z.core.$strict>>;
            cta: z.ZodOptional<z.ZodObject<{
                label: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                style: z.ZodEnum<{
                    primary: "primary";
                    secondary: "secondary";
                }>;
                action: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"openApp">;
                    appId: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"requestAccess">;
                    appId: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"openPage">;
                    pageId: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"openUrl">;
                    url: z.ZodString;
                }, z.core.$strict>]>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"richText">;
            content: z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"divider">;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"media">;
            kind: z.ZodEnum<{
                video: "video";
                image: "image";
            }>;
            mediaRef: z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
            caption: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            focal: z.ZodOptional<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, z.core.$strict>>;
            posterRef: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>>;
            captions: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>>;
                de: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"gallery">;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                mediaRef: z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>;
                alt: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                decorative: z.ZodOptional<z.ZodLiteral<true>>;
                caption: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"featureGrid">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                text: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                media: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                    alt: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    decorative: z.ZodOptional<z.ZodLiteral<true>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"benefits">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                text: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"faq">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                q: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                a: z.ZodObject<{
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
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"cta">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            text: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            label: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            style: z.ZodEnum<{
                primary: "primary";
                secondary: "secondary";
            }>;
            action: z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"openApp">;
                appId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"requestAccess">;
                appId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"openPage">;
                pageId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"openUrl">;
                url: z.ZodString;
            }, z.core.$strict>]>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"appCards">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"widget">;
            widgetId: z.ZodString;
            config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
        }, z.core.$strict>]>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const BLOCK_TYPES: readonly ["hero", "richText", "divider", "media", "gallery", "featureGrid", "benefits", "faq", "cta", "appCards", "widget", "tabs"];
export type BlockType = (typeof BLOCK_TYPES)[number];
/** The closed union of every block: an unknown `type` is refused. */
export declare const blockSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"hero">;
    heading: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    subheading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    media: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
    }, z.core.$strict>>;
    cta: z.ZodOptional<z.ZodObject<{
        label: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        style: z.ZodEnum<{
            primary: "primary";
            secondary: "secondary";
        }>;
        action: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"openApp">;
            appId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"requestAccess">;
            appId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"openPage">;
            pageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"openUrl">;
            url: z.ZodString;
        }, z.core.$strict>]>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"richText">;
    content: z.ZodObject<{
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
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"divider">;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"media">;
    kind: z.ZodEnum<{
        video: "video";
        image: "image";
    }>;
    mediaRef: z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>;
    alt: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    decorative: z.ZodOptional<z.ZodLiteral<true>>;
    caption: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    focal: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strict>>;
    posterRef: z.ZodOptional<z.ZodObject<{
        mediaId: z.ZodString;
    }, z.core.$strict>>;
    captions: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>>;
        de: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"gallery">;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        mediaRef: z.ZodObject<{
            mediaId: z.ZodString;
        }, z.core.$strict>;
        alt: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        decorative: z.ZodOptional<z.ZodLiteral<true>>;
        caption: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"featureGrid">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        text: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        media: z.ZodOptional<z.ZodObject<{
            mediaId: z.ZodString;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"benefits">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        text: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"faq">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        q: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        a: z.ZodObject<{
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
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"cta">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    text: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    label: z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    style: z.ZodEnum<{
        primary: "primary";
        secondary: "secondary";
    }>;
    action: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"openApp">;
        appId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"requestAccess">;
        appId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"openPage">;
        pageId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"openUrl">;
        url: z.ZodString;
    }, z.core.$strict>]>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"appCards">;
    heading: z.ZodOptional<z.ZodObject<{
        en: z.ZodOptional<z.ZodString>;
        de: z.ZodOptional<z.ZodString>;
        basis: z.ZodOptional<z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"widget">;
    widgetId: z.ZodString;
    config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    type: z.ZodLiteral<"tabs">;
    tabs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodObject<{
            en: z.ZodOptional<z.ZodString>;
            de: z.ZodOptional<z.ZodString>;
            basis: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        blocks: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"hero">;
            heading: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            subheading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            media: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
                alt: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                decorative: z.ZodOptional<z.ZodLiteral<true>>;
            }, z.core.$strict>>;
            cta: z.ZodOptional<z.ZodObject<{
                label: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                style: z.ZodEnum<{
                    primary: "primary";
                    secondary: "secondary";
                }>;
                action: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"openApp">;
                    appId: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"requestAccess">;
                    appId: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"openPage">;
                    pageId: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"openUrl">;
                    url: z.ZodString;
                }, z.core.$strict>]>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"richText">;
            content: z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"divider">;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"media">;
            kind: z.ZodEnum<{
                video: "video";
                image: "image";
            }>;
            mediaRef: z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>;
            alt: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            decorative: z.ZodOptional<z.ZodLiteral<true>>;
            caption: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            focal: z.ZodOptional<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, z.core.$strict>>;
            posterRef: z.ZodOptional<z.ZodObject<{
                mediaId: z.ZodString;
            }, z.core.$strict>>;
            captions: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>>;
                de: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"gallery">;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                mediaRef: z.ZodObject<{
                    mediaId: z.ZodString;
                }, z.core.$strict>;
                alt: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                decorative: z.ZodOptional<z.ZodLiteral<true>>;
                caption: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"featureGrid">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                text: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
                media: z.ZodOptional<z.ZodObject<{
                    mediaId: z.ZodString;
                    alt: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                        basis: z.ZodOptional<z.ZodObject<{
                            en: z.ZodOptional<z.ZodString>;
                            de: z.ZodOptional<z.ZodString>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>>;
                    decorative: z.ZodOptional<z.ZodLiteral<true>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"benefits">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                text: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"faq">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            items: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                q: z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                    basis: z.ZodOptional<z.ZodObject<{
                        en: z.ZodOptional<z.ZodString>;
                        de: z.ZodOptional<z.ZodString>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                a: z.ZodObject<{
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
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"cta">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            text: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            label: z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            style: z.ZodEnum<{
                primary: "primary";
                secondary: "secondary";
            }>;
            action: z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"openApp">;
                appId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"requestAccess">;
                appId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"openPage">;
                pageId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"openUrl">;
                url: z.ZodString;
            }, z.core.$strict>]>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"appCards">;
            heading: z.ZodOptional<z.ZodObject<{
                en: z.ZodOptional<z.ZodString>;
                de: z.ZodOptional<z.ZodString>;
                basis: z.ZodOptional<z.ZodObject<{
                    en: z.ZodOptional<z.ZodString>;
                    de: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            appIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            source: z.ZodOptional<z.ZodLiteral<"all-visible">>;
        }, z.core.$strict>, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"widget">;
            widgetId: z.ZodString;
            config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>]>>>;
        }, z.core.$strict>]>>;
    }, z.core.$strict>>;
}, z.core.$strict>]>;
export type Block = z.infer<typeof blockSchema>;
