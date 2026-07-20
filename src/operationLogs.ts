export type OperationLogLevel = "info" | "success" | "error";

export interface OperationLogEntry {
  id: string;
  action: string;
  detail?: string;
  level: OperationLogLevel;
  timestamp: number;
}

const OPERATION_LOG_STORAGE_KEY = "gpt_image_operation_logs";
const MAX_OPERATION_LOG_ENTRIES = 500;

export function getOperationLogs(): OperationLogEntry[] {
  try {
    const saved = localStorage.getItem(OPERATION_LOG_STORAGE_KEY);
    const entries = saved ? JSON.parse(saved) : [];
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    console.warn("Unable to read operation logs.", error);
    return [];
  }
}

export function recordOperationLog(
  action: string,
  detail?: string,
  level: OperationLogLevel = "info"
): OperationLogEntry {
  const entry: OperationLogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    detail,
    level,
    timestamp: Date.now(),
  };

  try {
    const entries = getOperationLogs();
    localStorage.setItem(OPERATION_LOG_STORAGE_KEY, JSON.stringify([...entries, entry].slice(-MAX_OPERATION_LOG_ENTRIES)));
  } catch (error) {
    console.warn("Unable to save operation log.", error);
  }

  return entry;
}

export function clearOperationLogs() {
  try {
    localStorage.removeItem(OPERATION_LOG_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to clear operation logs.", error);
  }
}