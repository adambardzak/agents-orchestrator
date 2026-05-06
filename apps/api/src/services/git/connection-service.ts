/**
 * Connection service — manages `git_connections` rows.
 *
 * Tokens are encrypted at rest with `encryptString()` from services/crypto.ts.
 * The plaintext access token is never persisted; we decrypt on demand only
 * when calling provider APIs.
 *
 * Connections are scoped PER USER (not per organization). The same user
 * authorising the same provider account always maps to a single row, so the
 * uniqueness constraint is `(user_id, provider, account_id)`. Org context is
 * irrelevant — a user's GitHub/GitLab/Bitbucket account is inherently personal
 * and they see their own repos regardless of which org they're working in.
 */
import type { Pool } from 'pg';
import { encryptString, decryptString } from '../crypto.js';
import type { GitProviderId, GitAccount, OAuthTokens } from './provider.js';

export interface GitConnection {
  id:                 string;
  userId:             string;
  provider:           GitProviderId;
  accountLogin:       string;
  accountId:          string;
  scopes:             string[];
  defaultVisibility:  'private' | 'public' | 'internal';
  tokenExpiresAt:     Date | null;
  createdAt:          Date;
  updatedAt:          Date;
}

export class GitConnectionService {
  constructor(private readonly pool: Pool) {}

  /** All connections for a user, across every org/context. */
  async listForUser(userId: string): Promise<GitConnection[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM git_connections WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(this.mapRow);
  }

  async getById(id: string): Promise<GitConnection | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT * FROM git_connections WHERE id = $1`,
      [id],
    );
    return r ? this.mapRow(r) : null;
  }

  /** Find an existing connection for upsert during OAuth callback. */
  async findExisting(args: {
    userId: string;
    provider: GitProviderId;
    accountId: string;
  }): Promise<GitConnection | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT * FROM git_connections
        WHERE user_id = $1 AND provider = $2 AND account_id = $3`,
      [args.userId, args.provider, args.accountId],
    );
    return r ? this.mapRow(r) : null;
  }

  /** Insert or update connection after a successful OAuth flow. */
  async upsertFromOAuth(args: {
    userId: string;
    provider: GitProviderId;
    account: GitAccount;
    tokens: OAuthTokens;
  }): Promise<GitConnection> {
    const accessEnc  = encryptString(args.tokens.accessToken);
    const refreshEnc = args.tokens.refreshToken
      ? encryptString(args.tokens.refreshToken)
      : null;

    const { rows: [r] } = await this.pool.query(
      `INSERT INTO git_connections
         (user_id, provider, account_login, account_id,
          access_token_enc, refresh_token_enc, token_expires_at, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, provider, account_id) DO UPDATE
         SET access_token_enc  = EXCLUDED.access_token_enc,
             refresh_token_enc = EXCLUDED.refresh_token_enc,
             token_expires_at  = EXCLUDED.token_expires_at,
             scopes            = EXCLUDED.scopes,
             account_login     = EXCLUDED.account_login,
             updated_at        = NOW()
       RETURNING *`,
      [
        args.userId, args.provider,
        args.account.login, args.account.id,
        accessEnc, refreshEnc, args.tokens.expiresAt ?? null,
        args.tokens.scopes,
      ],
    );
    return this.mapRow(r);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM git_connections WHERE id = $1`, [id]);
  }

  async setDefaultVisibility(id: string, visibility: 'private' | 'public' | 'internal'): Promise<void> {
    await this.pool.query(
      `UPDATE git_connections SET default_visibility = $1, updated_at = NOW() WHERE id = $2`,
      [visibility, id],
    );
  }

  /**
   * Returns the plaintext access token for a connection. Use sparingly —
   * never log it, never persist it in plaintext, never echo it back to clients.
   */
  async getAccessToken(id: string): Promise<string | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT access_token_enc FROM git_connections WHERE id = $1`,
      [id],
    );
    if (!r) return null;
    return decryptString(String(r['access_token_enc']));
  }

  // ── private ──────────────────────────────────────────────────────────────
  private mapRow(r: Record<string, unknown>): GitConnection {
    return {
      id:                String(r['id']),
      userId:            String(r['user_id']),
      provider:          r['provider'] as GitProviderId,
      accountLogin:      String(r['account_login']),
      accountId:         String(r['account_id']),
      scopes:            (r['scopes'] as string[] | null) ?? [],
      defaultVisibility: r['default_visibility'] as 'private' | 'public' | 'internal',
      tokenExpiresAt:    r['token_expires_at'] ? new Date(r['token_expires_at'] as string) : null,
      createdAt:         new Date(r['created_at'] as string),
      updatedAt:         new Date(r['updated_at'] as string),
    };
  }
}
