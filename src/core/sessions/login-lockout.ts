export const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export const checkAccountLock = async (prisma: any, user: any) => {
  if (!user.lockedUntil) return false;
  if (user.lockedUntil < new Date()) {
    await prisma.usuario.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null, lastFailedAttempt: null },
    });
    return false;
  }
  return true;
};

export const recordFailedAttempt = async (
  prisma: any,
  userId: string,
  email: string,
  ip: string,
  userAgent: string,
  motivo = "senha_incorreta",
) => {
  const updatedUser = await prisma.usuario.update({
    where: { id: userId },
    data: { loginAttempts: { increment: 1 }, lastFailedAttempt: new Date() },
  });
  await prisma.loginTentativa.create({
    data: { email, usuarioId: userId, sucesso: false, ip, userAgent, motivo },
  });
  if (updatedUser.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    await prisma.usuario.update({ where: { id: userId }, data: { lockedUntil } });
    await prisma.loginTentativa.create({
      data: {
        email,
        usuarioId: userId,
        sucesso: false,
        ip,
        userAgent,
        motivo: `conta_bloqueada_${Math.ceil(LOCKOUT_DURATION_MS / 60000)}min`,
      },
    });
  }
  return updatedUser;
};

export const resetLoginAttempts = async (
  prisma: any,
  userId: string,
  email: string,
  ip: string,
  userAgent: string,
) => {
  await prisma.usuario.update({
    where: { id: userId },
    data: { loginAttempts: 0, lockedUntil: null, lastFailedAttempt: null },
  });
  await prisma.loginTentativa.create({
    data: { email, usuarioId: userId, sucesso: true, ip, userAgent, motivo: "login_sucesso" },
  });
};
