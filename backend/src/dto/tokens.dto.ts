export interface IssueTokenBody {
  name?: string | null;
  /** A zeit/ms duration such as "24h". Omit to use jwtDefaultExpiration. */
  expires_in?: string | null;
}
