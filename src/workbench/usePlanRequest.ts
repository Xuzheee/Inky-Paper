import { useEffect, useRef, useState } from "react";
import { getError, paper } from "./model";

type PendingRequest = {
  action: string;
  input: Record<string, unknown>;
  fingerprint: string;
};
type StoredRequest = {
  schemaVersion: 1;
  pending: PendingRequest;
  definitiveFailure: boolean;
};
const definitive = (error: unknown) =>
  /^(CONFLICT:|INVALID_INPUT:|NOT_FOUND:|BUSY:|ACTIVE_SESSION:|ACTION_COMPLETED|TASK_COMPLETED|FORBIDDEN:|REQUEST_ID_REUSED:)/.test(
    getError(error),
  );
const read = (key?: string) => {
  try {
    const value: StoredRequest | null = key
      ? JSON.parse(localStorage.getItem(key) || "null")
      : null;
    if (
      value &&
      (value.schemaVersion !== 1 ||
        !value.pending?.action ||
        typeof value.pending.input?.requestId !== "string" ||
        typeof value.pending.fingerprint !== "string")
    )
      throw Error("invalid request");
    return { key, value, error: "" };
  } catch {
    return {
      key,
      value: null,
      error: "待核实请求无法读取。请保留本地记录并检查，暂未发送新操作。",
    };
  }
};

/** A scoped durable journal keeps an uncertain write tied to its original operation. */
export function usePlanRequest(storageKey?: string) {
  const [stored, setStored] = useState(() => read(storageKey));
  const current = useRef(stored);
  const running = useRef(false);
  useEffect(() => {
    if (current.current.key !== storageKey) {
      const next = read(storageKey);
      current.current = next;
      setStored(next);
    }
  }, [storageKey]);
  const ready = !!storageKey && stored.key === storageKey && !stored.error;
  const publish = (value: StoredRequest | null) => {
    if (
      !storageKey ||
      current.current.key !== storageKey ||
      current.current.error
    )
      throw Error("本地草稿存储尚未就绪，请稍后重试。");
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {
      const next = {
        ...current.current,
        error:
          "无法保存待核实请求，请检查本地存储后重新打开工作台。原请求保留，暂不发送新操作。",
      };
      current.current = next;
      setStored(next);
      throw Error(next.error);
    }
    const next = { key: storageKey, value, error: "" };
    current.current = next;
    setStored(next);
  };
  const execute = async (request: PendingRequest) => {
    if (!ready)
      throw Error(stored.error || "本地草稿存储尚未就绪，请稍后重试。");
    if (running.current) throw Error("正在核实这次操作，请稍等。");
    // Complete durable storage before IPC, including stable generated object ids.
    publish({ schemaVersion: 1, pending: request, definitiveFailure: false });
    running.current = true;
    try {
      const data = await paper(request.action, request.input);
      publish(null);
      return data;
    } catch (error) {
      if (!current.current.error)
        publish({
          schemaVersion: 1,
          pending: request,
          definitiveFailure: definitive(error),
        });
      throw error;
    } finally {
      running.current = false;
    }
  };
  const submit = (action: string, input: Record<string, unknown>) => {
    const fingerprint = JSON.stringify([action, input]);
    const cached = current.current.value;
    if (cached?.pending.fingerprint === fingerprint)
      return execute(cached.pending);
    if (cached && !cached.definitiveFailure)
      return Promise.reject(
        Error("上次操作尚未确认，请先使用原提交核实并重试。"),
      );
    return execute({
      action,
      input: JSON.parse(
        JSON.stringify({ ...input, requestId: crypto.randomUUID() }),
      ),
      fingerprint,
    });
  };
  const retry = () =>
    current.current.value
      ? execute(current.current.value.pending)
      : Promise.reject(Error("没有需要重试的操作。"));
  const discardDefinitiveFailure = () => {
    if (!current.current.value?.definitiveFailure || running.current)
      return false;
    publish(null);
    return true;
  };
  return {
    submit,
    retry,
    ready,
    storageError: stored.error,
    pending: stored.value?.pending || null,
    definitiveFailure: stored.value?.definitiveFailure || false,
    discardDefinitiveFailure,
  };
}
