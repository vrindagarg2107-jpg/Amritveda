import { z } from 'zod';
import { insertUserSchema, users } from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  unauthorized: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

export const api = {
  auth: {
    register: {
      method: 'POST' as const,
      path: '/api/auth/register' as const,
      input: insertUserSchema,
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    login: {
      method: 'POST' as const,
      path: '/api/auth/login' as const,
      input: z.object({ email: z.string(), password: z.string() }),
      responses: {
        200: z.object({ user: z.custom<typeof users.$inferSelect>(), token: z.string() }),
        401: errorSchemas.unauthorized,
      },
    },
    profile: {
      method: 'GET' as const,
      path: '/api/profile' as const,
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    }
  },
  disease: {
    predict: {
      method: 'POST' as const,
      path: '/api/disease/predict' as const,
      input: z.object({ symptoms: z.array(z.string()) }),
      responses: {
        200: z.object({
          predictedDisease: z.string(),
          confidence: z.string(),
          remedies: z.array(z.string()),
          foods: z.array(z.string()),
        }),
      }
    }
  },
  dosha: {
    analyze: {
      method: 'POST' as const,
      path: '/api/dosha/analyze' as const,
      input: z.object({ answers: z.record(z.string()) }),
      responses: {
        200: z.object({
          dosha: z.string(),
          lifestyleAdvice: z.array(z.string()),
          recommendations: z.array(z.string()),
        }),
      }
    }
  },
  remedy: {
    generate: {
      method: 'POST' as const,
      path: '/api/remedy/generate' as const,
      input: z.object({ symptoms: z.array(z.string()) }),
      responses: {
        200: z.object({
          remedies: z.array(z.string()),
          naturalTreatments: z.array(z.string()),
          warnings: z.array(z.string()),
        }),
      }
    }
  },
  chat: {
    send: {
      method: 'POST' as const,
      path: '/api/chat' as const,
      input: z.object({ message: z.string() }),
      responses: {
        200: z.object({ response: z.string() })
      }
    }
  },
  practitioner: {
    patients: {
      method: 'GET' as const,
      path: '/api/practitioner/patients' as const,
      responses: {
        200: z.array(z.custom<typeof users.$inferSelect>()),
        401: errorSchemas.unauthorized,
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
