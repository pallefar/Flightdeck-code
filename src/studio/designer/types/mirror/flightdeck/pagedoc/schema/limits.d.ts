/** Every section, column, block, tab and list-item id: lower-case letters and digits. */
export declare const ID_PATTERN: RegExp;
/** A media library item id: exactly 24 lower-case letters or digits (never a URL). */
export declare const MEDIA_ID_PATTERN: RegExp;
export declare const LIMITS: {
    readonly idPattern: RegExp;
    /** Sections per doc. */
    readonly maxSections: 40;
    /** Columns per section (the widest layout is '1-1-1'). */
    readonly maxColumns: 3;
    /** Blocks per doc, counted at every depth (blocks inside tabs included). */
    readonly maxBlocks: 150;
    /** Items in one rich-text list. */
    readonly maxListItems: 30;
    /** Tabs in one tabs block: at least two (one tab is not a choice), at most six. */
    readonly minTabs: 2;
    readonly maxTabs: 6;
    /** Images in one gallery. */
    readonly maxGalleryItems: 24;
    /** Items in one feature grid. */
    readonly maxFeatureItems: 12;
    /** Items in one benefits list. */
    readonly maxBenefitItems: 8;
    /** Question/answer pairs in one FAQ. */
    readonly maxFaqItems: 30;
    /** Apps named in one app-cards block. */
    readonly maxAppCards: 12;
    /** Keys in one widget block's config. */
    readonly maxWidgetConfigKeys: 20;
    /** UTF-8 bytes of text in one block, every language together. */
    readonly maxBlockTextBytes: number;
    /** UTF-8 bytes of the serialized doc. */
    readonly maxDocBytes: number;
    /** section (1) > column (2) > block (3) > tab (4) > block (5). */
    readonly maxDepth: 5;
    /** Characters in a page title, per language (the v1 page registry's bound). */
    readonly maxTitleChars: 80;
};
/** UTF-8 byte length without Buffer (portable: browsers and Node). */
export declare function utf8Bytes(s: string): number;
