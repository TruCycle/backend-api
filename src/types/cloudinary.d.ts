declare module "cloudinary" {
  export interface UploadApiOptions {
    public_id?: string;
    folder?: string;
    overwrite?: boolean;
    invalidate?: boolean;
    resource_type?: string;
    format?: string;
    type?: string;
    access_mode?: string;
    tags?: string[];
    context?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface UploadApiResponse {
    public_id: string;
    version: number;
    signature?: string;
    width?: number;
    height?: number;
    format?: string;
    resource_type?: string;
    created_at?: string;
    secure_url?: string;
    url?: string;
    bytes?: number;
    [key: string]: unknown;
  }

  export interface UploadApiErrorResponse extends Error {
    http_code?: number;
    name: string;
    message: string;
    [key: string]: unknown;
  }

  export interface UploadStream {
    end(buffer: Buffer): void;
  }

  export interface Uploader {
    upload_stream(
      options: UploadApiOptions,
      callback: (error: UploadApiErrorResponse | null, result?: UploadApiResponse | null) => void,
    ): UploadStream;
  }

  export interface ConfigOptions {
    cloud_name?: string;
    api_key?: string;
    api_secret?: string;
    secure?: boolean;
    [key: string]: unknown;
  }

  export interface Cloudinary {
    config(options: ConfigOptions): void;
    uploader: Uploader;
  }

  export const v2: Cloudinary;
}