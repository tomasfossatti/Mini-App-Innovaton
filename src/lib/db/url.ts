/**
 * Neon agrega `channel_binding=require` a sus connection strings. Es una opción de libpq:
 * postgres-js la reenvía al servidor como parámetro de sesión y Postgres rechaza la
 * conexión ("unrecognized configuration parameter"). Se quita antes de conectar; el TLS
 * sigue garantizado por `sslmode=require`.
 */
export function connectionUrl(url: string): string {
  return url.replace(/([?&])channel_binding=[^&]*&?/g, "$1").replace(/[?&]$/, "");
}
