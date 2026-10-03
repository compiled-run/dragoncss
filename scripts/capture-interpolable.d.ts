/** Every property name, and the names whose interpolable flag is true or whose valid_for_keyframe flag is false; all sorted. */
export type InterpolableSnapshot = {
    readonly source: string;
    readonly sha256: string;
    readonly properties: readonly string[];
    readonly interpolable: readonly string[];
    readonly notValidForKeyframe: readonly string[];
};
/** JSON5 as css_properties.json5 writes it: comments, unquoted keys, single-quoted strings and trailing commas, made JSON. */
export declare function json5ToJson(text: string): string;
export declare function snapshotOf(text: string): InterpolableSnapshot;
