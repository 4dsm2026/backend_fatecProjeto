import type { Prisma } from "@prisma/client";
import { PaginationQuerySchema, buildLinks, link, path } from "../../hateoas";
import type { Link, Role, Viewer } from "../../hateoas";
import { z } from "zod";

export const USER_STAFF_ROLES = ["ADMINISTRADOR", "BACKOFFICE", "TECNICO"] as const satisfies readonly Role[];
export const USER_ADMIN_ROLES = ["ADMINISTRADOR"] as const satisfies readonly Role[];
export const USER_AUTHENTICATED_ROLES = [
	"USUARIO",
	...USER_STAFF_ROLES,
] as const satisfies readonly Role[];

export const userPublicSelect = {
	id: true,
	organizacaoId: true,
	nome: true,
	emailPessoal: true,
	emailEducacional: true,
	ra: true,
	cursoNome: true,
	cursoSigla: true,
	papel: true,
	ativo: true,
	anonimizado: true,
	criadoEm: true,
	atualizadoEm: true,
	deletadoEm: true,
	unidadeFatec: true,
	curso: true,
	eixoTecnologico: true,
	turno: true,
	turma: true,
	semestreAtual: true,
	matrizCurricular: true,
	situacaoAcademica: true,
	anoSemestreIngresso: true,
	coordenadorCurso: true,
	telefoneCelular: true,
	whatsapp: true,
	canalPreferencialContato: true,
	melhorPeriodoContato: true,
	necessitaAtendimentoAcessivel: true,
	tipoAcessibilidade: true,
	observacoesAtendimento: true,
	notificacoesInApp: true,
} satisfies Prisma.UsuarioSelect;

export type UserPublic = Prisma.UsuarioGetPayload<{ select: typeof userPublicSelect }>;

export const UsersListQuerySchema = PaginationQuerySchema.extend({
	q: z.string().trim().min(1).optional(),
});

export type UsersListQuery = z.infer<typeof UsersListQuerySchema>;

export interface UserListResult {
	items: UserPublic[];
	total: number;
}

function hasRole(roles: readonly Role[], role: Role): boolean {
	return roles.includes(role);
}

export function isUserStaff(role: Role): boolean {
	return hasRole(USER_STAFF_ROLES, role);
}

export function isUserAdmin(role: Role): boolean {
	return hasRole(USER_ADMIN_ROLES, role);
}

export function isAdminSelf(user: Pick<UserPublic, "id" | "papel">, viewer: Viewer): boolean {
	return isUserAdmin(viewer.role) && user.id === viewer.id && user.papel === "ADMINISTRADOR";
}

export function hasProtectedAdminSelfUpdate(
	user: Pick<UserPublic, "id" | "papel">,
	viewer: Viewer,
	patch: { ativo?: boolean; papel?: Role; anonimizado?: boolean },
): boolean {
	if (!isAdminSelf(user, viewer)) return false;
	return patch.ativo === false || patch.anonimizado === true ||
		(patch.papel !== undefined && patch.papel !== "ADMINISTRADOR");
}

const RESTRICTED_USER_UPDATE_FIELDS = ["senha", "papel", "organizacaoId", "anonimizado", "ativo"] as const;

export function hasRestrictedUserUpdateField(fields: readonly string[]): boolean {
	return fields.some((field) => RESTRICTED_USER_UPDATE_FIELDS.some((restrictedField) => restrictedField === field));
}

export function canUpdateUserTarget(user: Pick<UserPublic, "id" | "papel">, viewer: Viewer): boolean {
	if (isUserAdmin(viewer.role)) return true;
	if (user.papel === "ADMINISTRADOR") return false;
	if (user.id === viewer.id) return true;
	if (viewer.role === "USUARIO") return false;
	return user.papel === "USUARIO";
}

export function canUpdateUserFields(
	user: Pick<UserPublic, "id" | "papel">,
	viewer: Viewer,
	fields: readonly string[],
): boolean {
	if (isUserAdmin(viewer.role)) return true;

	for (const field of fields) {
		if (!RESTRICTED_USER_UPDATE_FIELDS.some((restrictedField) => restrictedField === field)) continue;
		const mayUpdateActiveUser =
			field === "ativo" &&
			viewer.role !== "USUARIO" &&
			user.papel === "USUARIO" &&
			user.id !== viewer.id;
		if (!mayUpdateActiveUser) return false;
	}

	return true;
}

export function buildUserLinks(user: Pick<UserPublic, "id" | "papel" | "deletadoEm">, viewer: Viewer) {
	const notRemoved = user.deletadoEm === null;
	const staff = isUserStaff(viewer.role);
	const admin = isUserAdmin(viewer.role);
	const protectedAdminSelf = isAdminSelf(user, viewer);
	const href = path`/users/${user.id}`;

	const changeRoleLink: Link | false = notRemoved && admin && !protectedAdminSelf
		? link(href, "PATCH", { title: "Alterar papel" })
		: false;

	return buildLinks({
		self: link(href),
		collection: staff && link("/users"),
		update: notRemoved && canUpdateUserTarget(user, viewer) && link(href, "PATCH"),
		"change-role": changeRoleLink,
		delete: notRemoved && admin && !protectedAdminSelf && link(href, "DELETE"),
	});
}
