/* Types for comment-file.mjs, which stays plain JavaScript so the tools can import it with no build step. */
import type { CanvasCommentFile } from "./types";

export type CommentPaths = {
  slug: string;
  json: string;
  images: string;
  imagesRel: string;
  history: string;
};

export const CONTRACT: string;
export function commentPaths(canvasDir: string, slug: string): CommentPaths;
export function highestIdIn(comments: ReadonlyArray<{ id: string }> | undefined): number;
export function nextCommentId(comments: ReadonlyArray<{ id: string }>, floor?: number): string;
export function readCommentFile(paths: CommentPaths): Promise<CanvasCommentFile>;
export function writeCommentFile(
  paths: CommentPaths,
  file: Pick<CanvasCommentFile, "comments"> & Partial<CanvasCommentFile>,
  why?: string,
): Promise<CanvasCommentFile>;
export function commitHistory(paths: CommentPaths, why: string): Promise<void>;
