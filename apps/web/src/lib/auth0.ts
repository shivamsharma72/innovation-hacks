import { Auth0Client } from "@auth0/nextjs-auth0/server";

const audience = process.env.AUTH0_AUDIENCE;

export const auth0 = new Auth0Client({
  authorizationParameters: audience
    ? {
        audience,
        scope: "openid profile email offline_access",
      }
    : {
        scope: "openid profile email offline_access",
      },
});
