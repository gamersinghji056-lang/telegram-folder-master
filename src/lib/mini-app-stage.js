export function miniStatusAllowsApp(status) {
  return Boolean(status?.connected || status?.localDevSessionBypass === true);
}
