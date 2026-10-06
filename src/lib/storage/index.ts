import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { artifactBlobs } from "@/lib/db/schema";

/**
 * Storage privado de artefactos (fotos del A3).
 * Driver por defecto: Postgres (tabla artifact_blobs), con storage_path "db:<uuid>".
 * El acceso es solo por Route Handler autenticado de staff. Para usar un bucket externo
 * alcanza con implementar otro driver con esta misma interfaz.
 */
export interface ArtifactStorage {
  put(db: DbOrTx, data: Buffer): Promise<string>;
  get(db: DbOrTx, storagePath: string): Promise<Buffer | null>;
  remove(db: DbOrTx, storagePath: string): Promise<void>;
}

const DB_PREFIX = "db:";

export const dbStorage: ArtifactStorage = {
  async put(db, data) {
    const [row] = await db.insert(artifactBlobs).values({ data }).returning({ id: artifactBlobs.id });
    return `${DB_PREFIX}${row.id}`;
  },
  async get(db, storagePath) {
    if (!storagePath.startsWith(DB_PREFIX)) return null;
    const id = storagePath.slice(DB_PREFIX.length);
    const row = await db.query.artifactBlobs.findFirst({ where: eq(artifactBlobs.id, id) });
    return row?.data ?? null;
  },
  async remove(db, storagePath) {
    if (!storagePath.startsWith(DB_PREFIX)) return;
    await db.delete(artifactBlobs).where(eq(artifactBlobs.id, storagePath.slice(DB_PREFIX.length)));
  },
};

export function getStorage(): ArtifactStorage {
  return dbStorage;
}

export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const ALLOWED_ARTIFACT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
