// ============================================================================
// NetCafe Pro — WebSocket Protocol Type Definitions (Client <-> Server)
// ============================================================================

export type ComputerStatus = 'OFFLINE' | 'AVAILABLE' | 'OCCUPIED' | 'LOCKED' | 'MAINTENANCE';
export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type PaymentType = 'CASH' | 'CARD' | 'CLICK' | 'PAYME';

// Base Protocol Envelope
export interface ProtocolMessage<T = unknown> {
  event: string;
  payload: T;
  timestamp: number; // Unix timestamp milliseconds (e.g. 1773328400000)
}

// ----------------------------------------------------------------------------
// CLIENT -> SERVER PAYLOADS
// ----------------------------------------------------------------------------

export interface ClientHandshakePayload {
  pcNumber: number;
  macAddress: string;
  ipAddress?: string;
  agentVersion: string;
  osInfo: string;
}

export interface HeartbeatPingPayload {
  pcId: string;
  pcNumber: number;
  cpuUsage: number;       // 0 - 100 foiz
  ramUsage: number;       // 0 - 100 foiz
  activeProcess?: string; // Faol oynadagi oyna nomi (masalan: "cs2.exe")
  uptimeSeconds: number;
}

export interface SessionAlertPayload {
  pcId: string;
  sessionId?: string;
  alertType: 'UNAUTHORIZED_PROCESS' | 'SYSTEM_TIME_TAMPERING' | 'FORCE_KILL_ATTEMPT' | 'AGENT_CRASH';
  details: string;
  severity: 'WARNING' | 'CRITICAL';
}

// ----------------------------------------------------------------------------
// SERVER -> CLIENT PAYLOADS
// ----------------------------------------------------------------------------

export interface HandshakeAckPayload {
  status: 'SUCCESS' | 'REJECTED';
  pcId: string;
  pcNumber: number;
  currentStatus: ComputerStatus;
  serverTime: number;
  activeSession: {
    sessionId: string;
    tariffName: string;
    startedAt: number;
    endsAt: number;
    remainingSeconds: number;
  } | null;
  message?: string;
}

export interface LockScreenPayload {
  reason: 'SESSION_ENDED' | 'ADMIN_LOCK' | 'MAINTENANCE' | 'SECURITY_VIOLATION' | 'UNPAID';
  message: string;
}

export interface StartSessionPayload {
  sessionId: string;
  tariffName: string;
  startedAt: number;        // Epoch timestamp ms
  endsAt: number;           // Epoch timestamp ms
  remainingSeconds: number;
  customerName?: string;
}

export interface UpdateRemainingTimePayload {
  sessionId: string;
  remainingSeconds: number;
  endsAt: number;
}

export interface StopSessionPayload {
  sessionId: string;
  reason: 'TIME_EXPIRED' | 'ADMIN_TERMINATED' | 'TRANSFER' | 'USER_LOGOUT';
  forceKillApps: boolean;   // O'yinlar va brauzerlarni majburiy o'chirish
  message?: string;
}

export interface SendMessagePayload {
  messageId: string;
  title: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'URGENT';
  displayDurationSeconds: number;
}
