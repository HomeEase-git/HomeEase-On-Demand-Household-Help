import { batchApiCalls, classifyAxiosError } from '../apiErrorHandling';

describe('API Error Handling Utilities', () => {
  test('keeps falsy successful batch results', async () => {
    const result = await batchApiCalls<string | number | boolean>([
      async () => 0,
      async () => false,
      async () => '',
    ]);

    expect(result.successes).toEqual([0, false, '']);
    expect(result.failures).toHaveLength(0);
  });

  test('classifies axios-style validation responses', () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          message: 'Email is invalid',
        },
      },
    };

    const result = classifyAxiosError(error);

    expect(result).toMatchObject({
      type: 'validation',
      message: 'Email is invalid',
      statusCode: 422,
      isRetryable: false,
    });
  });
});
