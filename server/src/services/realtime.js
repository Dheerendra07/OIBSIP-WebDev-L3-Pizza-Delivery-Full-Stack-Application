import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { config } from '../config/env.js';
import { isSessionVersionCurrent } from '../utils/sessionVersion.js';

const allowedOrigins = String(config.clientOrigin || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const MAX_TIMER_DELAY_MS = 2_147_483_647;

let realtimeServer = null;

export function readSessionToken(cookieHeader) {
  const prefix = 'pizza_session=';
  const entry = String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}

export function isAllowedRealtimeOrigin(origin, origins = allowedOrigins) {
  return Boolean(origin && origins.includes(origin));
}

export function getSessionExpiry(payload, now = Date.now()) {
  if (!Number.isSafeInteger(payload?.exp)) return null;
  const expiresAt = payload.exp * 1000;
  return Number.isSafeInteger(expiresAt) && expiresAt > now ? expiresAt : null;
}

/**
 * Disconnect an authenticated socket when its JWT expires.
 * Long lifetimes are scheduled in safe timer-sized chunks; disconnect cleans up the timer.
 */
export function scheduleSocketExpiry(
  socket,
  expiresAt,
  { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  if (!Number.isFinite(expiresAt) || expiresAt <= now()) {
    socket.disconnect(true);
    return false;
  }

  let active = true;
  let timer = null;
  const cleanup = () => {
    if (!active) return;
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const scheduleNextCheck = () => {
    if (!active) return;
    const remaining = expiresAt - now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      cleanup();
      socket.disconnect(true);
      return;
    }
    timer = setTimer(() => {
      timer = null;
      scheduleNextCheck();
    }, Math.min(remaining, MAX_TIMER_DELAY_MS));
    if (typeof timer?.unref === 'function') timer.unref();
  };

  socket.once('disconnect', cleanup);
  scheduleNextCheck();
  return true;
}

export function buildOrderUpdatePayload(order) {
  if (!order) return null;
  const id = order._id ?? order.id;
  const user = order.user;
  const userId = user?._id ?? user;
  if (id == null || userId == null || !order.status || !order.paymentStatus) return null;

  const updatedAt = order.updatedAt ? new Date(order.updatedAt) : null;
  return {
    id: String(id),
    orderNumber: String(order.orderNumber || ''),
    status: String(order.status),
    paymentStatus: String(order.paymentStatus),
    updatedAt: updatedAt && Number.isFinite(updatedAt.getTime()) ? updatedAt.toISOString() : null,
  };
}

function relatedUserId(value) { return value?._id ?? value ?? null; }

export function publishOrderUpdate(order, target = realtimeServer) {
  const payload = buildOrderUpdatePayload(order);
  const user = order?.user;
  const userId = user?._id ?? user;
  if (!target || !payload || userId == null) return false;

  target.to(`user:${String(userId)}`).emit('order:update', payload);
  target.to('role:admin').emit('order:update', payload);
  const kitchenStaffId = relatedUserId(order.kitchenStaff);
  const deliveryStaffId = relatedUserId(order.deliveryStaff);
  if (kitchenStaffId != null) target.to(`staff:${String(kitchenStaffId)}`).emit('order:update', payload);
  if (deliveryStaffId != null) target.to(`staff:${String(deliveryStaffId)}`).emit('order:update', payload);
  return true;
}

export function publishAdminRefresh(target = realtimeServer) {
  if (!target) return false;
  target.to('role:admin').emit('admin:refresh', {});
  return true;
}

export async function disconnectUserSockets(userId, target = realtimeServer) {
  if (!target || userId == null) return 0;
  const sockets = await target.in(`user:${String(userId)}`).fetchSockets();
  for (const socket of sockets) socket.disconnect(true);
  return sockets.length;
}

export async function disconnectCurrentSessionSockets(cookieHeader) {
  const token = readSessionToken(cookieHeader);
  if (!token) return 0;

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, {
      issuer: 'pizza-house-api',
      audience: 'pizza-house-client',
    });
  } catch {
    return 0;
  }
  if (!payload?.sub) return 0;

  const user = await User.findById(payload.sub).select('emailVerifiedAt sessionVersion');
  if (!user || !user.emailVerifiedAt || !isSessionVersionCurrent(payload.sv, user.sessionVersion)) return 0;
  return disconnectUserSockets(user._id);
}

export function attachRealtimeServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    allowRequest: (request, callback) => {
      if (!isAllowedRealtimeOrigin(request.headers.origin)) {
        callback(new Error('Origin not allowed'), false);
        return;
      }
      callback(null, true);
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = readSessionToken(socket.request.headers.cookie);
      if (!token) return next(new Error('Authentication required'));

      let payload;
      try {
        payload = jwt.verify(token, config.jwtSecret, {
          issuer: 'pizza-house-api',
          audience: 'pizza-house-client',
        });
      } catch {
        return next(new Error('Authentication required'));
      }

      const expiresAt = getSessionExpiry(payload);
      if (expiresAt === null) return next(new Error('Authentication required'));

      const user = await User.findById(payload.sub).select('name email role active mustChangePassword emailVerifiedAt sessionVersion');
      if (
        !user ||
        user.active === false ||
        user.mustChangePassword === true ||
        !user.emailVerifiedAt ||
        !isSessionVersionCurrent(payload.sv, user.sessionVersion) ||
        !['user', 'admin', 'kitchen', 'delivery'].includes(user.role)
      ) {
        return next(new Error('Authentication required'));
      }

      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      socket.data.expiresAt = expiresAt;
      return next();
    } catch {
      return next(new Error('Authentication required'));
    }
  });

  io.on('connection', (socket) => {
    if (!scheduleSocketExpiry(socket, socket.data.expiresAt)) return;
    socket.join(`user:${socket.data.userId}`);
    if (socket.data.role === 'admin') socket.join('role:admin');
    if (socket.data.role === 'kitchen') socket.join('role:kitchen');
    if (socket.data.role === 'delivery') socket.join('role:delivery');
    if (['kitchen', 'delivery'].includes(socket.data.role)) socket.join(`staff:${socket.data.userId}`);
  });

  realtimeServer = io;
  return io;
}


export function publishOpsRefresh(target = realtimeServer) {
  if (!target) return false;
  // This invalidation event carries no order data. Staff must fetch their own
  // role-filtered queue through the authenticated operations endpoint.
  target.to('role:kitchen').emit('ops:refresh', {});
  target.to('role:delivery').emit('ops:refresh', {});
  return true;
}
