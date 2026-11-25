// Die Adresse des Clients aus X-Forwarded-For: der letzte Eintrag, also die, die der Edge-Caddy gesehen und selbst gesetzt hat (deploy/edge/cevi-os.caddy, header_up). Frühere Einträge schickt der Client mit und gelten nie (#775)
export function clientIp(xForwardedFor: string | null | undefined) {
  return xForwardedFor?.split(",").at(-1)?.trim() || undefined;
}
