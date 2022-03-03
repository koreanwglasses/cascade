import { sha1 } from "object-hash";

export const hash = (value: any) => sha1(JSON.stringify(value));
