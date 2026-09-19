export interface Storage {
  presignPut(key: string, contentType: string, contentLength: number): Promise<string>;
  presignGet(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  remove(keys: string[]): Promise<void>;
  list(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
}
export const GET_TTL_SECONDS = 3600;
export const PUT_TTL_SECONDS = 900;
export const thumbKeyOf = (key: string): string => key.replace(/\.jpg$/, '-thumb.jpg');
