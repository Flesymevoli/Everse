import { setGlobalProxyFromEnv } from "node:http";

/** Read existing proxy settings without changing the system or process environment. */
export function configureNetwork(env: NodeJS.ProcessEnv = process.env) {
  if (!(env.http_proxy || env.HTTP_PROXY || env.https_proxy || env.HTTPS_PROXY))
    return () => {};
  const bypass = [env.no_proxy ?? env.NO_PROXY, "localhost", "127.0.0.1", "::1"]
    .filter(Boolean)
    .join(",");
  return setGlobalProxyFromEnv({ ...env, NO_PROXY: bypass, no_proxy: bypass });
}
