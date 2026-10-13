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

export function buildUserLinks(user: Pick<UserPublic, "id" | "deletadoEm">, viewer: Viewer) {
	const notRemoved = user.deletadoEm === null;
	const staff = isUserStaff(viewer.role);
	const admin = isUserAdmin(viewer.role);
	const ownsUser = user.id === viewer.id;
	const href = path`/users/${user.id}`;

	const changeRoleLink: Link | false = notRemoved && admin
		? link(href, "PATCH", { title: "Alterar papel" })
		: false;

	return buildLinks({
		self: link(href),
		collection: staff && link("/users"),
		update: notRemoved && (staff || ownsUser) && link(href, "PATCH"),
		"change-role": changeRoleLink,
		delete: notRemoved && admin && link(href, "DELETE"),
	});
}
