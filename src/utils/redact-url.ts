/**
 * Tira de uma URL os segredos que viajam no caminho ou na query, para ela poder ir
 * para o log. O token de `/password-resets/:token` (e o de `/account-activations/:token`)
 * é uma credencial viva: quem lê o log consegue redefinir a senha da conta.
 */
export const REDACTED = "[REDACTED]";

// `[^/?#]+` não volta atrás: a regex é linear.
const SEGREDO_NO_CAMINHO = /^(\/(?:password-resets|account-activations)\/)[^/?#]+/;
const SEGREDO_NA_QUERY = /([?&]token=)[^&#]*/g;

export function redactUrl(url: string | undefined): string {
  return String(url ?? "")
    .replace(SEGREDO_NO_CAMINHO, `$1${REDACTED}`)
    .replace(SEGREDO_NA_QUERY, `$1${REDACTED}`);
}
