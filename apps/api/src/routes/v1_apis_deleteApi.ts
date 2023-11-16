import { db, apiCache, keyService, ApiId } from "@/pkg/global";
import { App } from "@/pkg/hono/app";
import { createRoute, z } from "@hono/zod-openapi";

import { withCache } from "@/pkg/cache/with_cache";
import { UnkeyApiError, openApiErrorResponses } from "@/pkg/errors";
import { schema } from "@unkey/db";
import { eq } from "drizzle-orm";

const route = createRoute({
  method: "post",
  path: "/v1/apis.deleteApi",
  request: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer [a-zA-Z0-9_]+/).openapi({
        description: "A root key to authorize the request formatted as bearer token",
        example: "Bearer unkey_1234",
      }),
    }),

    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            apiId: z.string().min(1).openapi({
              description: "The id of the api to delete",
              example: "api_1234",
            }),
          }),
        }
      }
    }

  },
  responses: {
    200: {
      description:
        "The api was successfully deleted, it may take up to 30s for this to take effect in all regions",
      content: {
        "application/json": {
          schema: z.object({}),
        },
      },
    },
    ...openApiErrorResponses,
  },
});
export type Route = typeof route;

export const registerV1ApisDeleteApi = (app: App) =>
  app.openapi(route, async (c) => {
    const authorization = c.req.header("authorization")!.replace("Bearer ", "");
    const rootKey = await keyService.verifyKey(c, { key: authorization });
    if (rootKey.error) {
      throw new UnkeyApiError({ code: "INTERNAL_SERVER_ERROR", message: rootKey.error.message });
    }
    if (!rootKey.value.valid) {
      throw new UnkeyApiError({ code: "UNAUTHORIZED", message: "the root key is not valid" });
    }
    if (!rootKey.value.isRootKey) {
      throw new UnkeyApiError({ code: "UNAUTHORIZED", message: "root key required" });
    }

    const { apiId } = c.req.valid("json")

    const api = await withCache(c, apiCache, async (id: ApiId) => {
      return (
        (await db.query.apis.findFirst({
          where: (table, { eq }) => eq(table.id, id),
        })) ?? null
      );
    })(apiId);

    if (!api || api.workspaceId !== rootKey.value.authorizedWorkspaceId) {
      throw new UnkeyApiError({ code: "NOT_FOUND", message: `api ${apiId} not found` });
    }
    await db.delete(schema.apis).where(eq(schema.apis.id, apiId));
    await apiCache.remove(c, apiId);

    return c.jsonT({});
  });