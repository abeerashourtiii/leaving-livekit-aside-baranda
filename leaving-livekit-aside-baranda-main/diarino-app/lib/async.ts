// ↔ أدوات مهلة/إعادة محاولة للطلبات اللى كانت بتعلّق بلا نهاية (شاشة بيضاء بعد الدخول، لوحة أدمن فاضية...):
// أى طلب شبكة/تخزين ممكن يتأخر أو "يتعلّق" (قفل جلسة supabase، شبكة ضعيفة)، ومن غير مهلة الشاشة بتفضل تستنى للأبد.
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`timeout:${label}:${ms}`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label = "request"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// يجرّب `attempts` مرات (كل مرة بمهلة timeoutMs) وبينهم انتظار قصير؛ يرمى آخر خطأ لو فشلوا كلهم.
export async function retryWithTimeout<T>(
  run: () => PromiseLike<T>,
  { attempts = 2, timeoutMs = 7000, delayMs = 400, label = "request" }: { attempts?: number; timeoutMs?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(run(), timeoutMs, label);
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw lastError;
}
