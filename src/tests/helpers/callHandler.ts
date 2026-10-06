import type { NextApiRequest, NextApiResponse } from 'next';

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

/**
 * Llama a una ruta de la API externa con la clave puesta y devuelve lo que respondió: estado,
 * body y los headers que puso. La clave la acepta el mock de `~/server/externalApi` de cada test.
 */
export const callHandler = async (
  handler: Handler,
  method: string,
  query: Record<string, string>,
  body?: unknown,
) => {
  const json = jest.fn();
  const res = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnValue({ json }),
  } as unknown as NextApiResponse;

  await handler(
    { method, headers: { authorization: 'Bearer key' }, query, body } as unknown as NextApiRequest,
    res,
  );

  return {
    status: (res.status as jest.Mock).mock.calls[0]?.[0],
    body: json.mock.calls[0]?.[0],
    headers: (res.setHeader as jest.Mock).mock.calls,
  };
};
