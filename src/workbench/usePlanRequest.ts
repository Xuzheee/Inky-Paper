import { useRef, useState } from "react";
import { getError, paper } from "./model";

type PendingRequest = {
  action: string;
  input: Record<string, unknown>;
  fingerprint: string;
};
const definitive = (error: unknown) =>
  /^(CONFLICT:|INVALID_INPUT:|NOT_FOUND:|BUSY:|ACTIVE_SESSION:|ACTION_COMPLETED|TASK_COMPLETED)/.test(
    getError(error),
  );

/** Keep a lost response tied to its original operation; changing parameters is a new operation. */
export function usePlanRequest() {
  const cached = useRef<PendingRequest | null>(null);
  const knownFailure = useRef(false);
  const running = useRef(false);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [definitiveFailure, setDefinitiveFailure] = useState(false);
  const execute = async (request: PendingRequest) => {
    if (running.current) throw Error("正在核实这次操作，请稍等。");
    running.current = true;
    cached.current = request;
    knownFailure.current = false;
    setPending(request);
    setDefinitiveFailure(false);
    try {
      const data = await paper(request.action, request.input);
      cached.current = null;
      setPending(null);
      return data;
    } catch (error) {
      knownFailure.current = definitive(error);
      setDefinitiveFailure(knownFailure.current);
      throw error;
    } finally {
      running.current = false;
    }
  };
  const submit = (action: string, input: Record<string, unknown>) => {
    const fingerprint = JSON.stringify([action, input]);
    if (cached.current?.fingerprint === fingerprint)
      return execute(cached.current);
    if (cached.current && !knownFailure.current)
      return Promise.reject(
        Error("上次操作尚未确认，请先使用原提交核实并重试。"),
      );
    return execute({
      action,
      input: { ...structuredClone(input), requestId: crypto.randomUUID() },
      fingerprint,
    });
  };
  const retry = () =>
    cached.current
      ? execute(cached.current)
      : Promise.reject(Error("没有需要重试的操作。"));
  const discardDefinitiveFailure = () => {
    if (!knownFailure.current || running.current) return false;
    cached.current = null;
    knownFailure.current = false;
    setPending(null);
    setDefinitiveFailure(false);
    return true;
  };
  return {
    submit,
    retry,
    pending,
    definitiveFailure,
    discardDefinitiveFailure,
  };
}
