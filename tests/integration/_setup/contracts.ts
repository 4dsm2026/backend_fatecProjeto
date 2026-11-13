/** Contratos compartilhados de integração, sem imports de runtime de app, Prisma ou env. */
export type TestContext = { baseUrl: string };
/** Contexto atualmente disponibilizado pelo harness serial provisório. */
export type HarnessContext = TestContext & { storageDir: string };
export type TestAppHandle = HarnessContext & { close: () => Promise<void> };
export type TestSession = { accessToken: string };
export type TestActor = TestSession & { userId: string };

/** Contratos propostos para auth; sujeitos ao alinhamento com Rodrigo. */
export type Role = 'USUARIO' | 'BACKOFFICE' | 'TECNICO' | 'ADMINISTRADOR';
export type Actor = { id: string; role: Role; email: string; password: string };
export type Session = TestSession & { actor: Actor; refreshToken: string };
/** Contrato proposto para quando a mailbox de Rodrigo estiver integrada. */
export type IntegrationContext = HarnessContext & { mailboxUrl: string };

/** Tipos concretos de hipermídia HAL e erros RFC 7807. */
export type HalMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type HalLink = {
  href: string;
  method?: HalMethod;
  title?: string;
  name?: string;
};

export type HalLinks = Record<string, HalLink | HalLink[] | undefined>;

export type HalResource<L extends HalLinks = HalLinks> = {
  _links: L;
};

export type HalPageInfo = {
  size: number;
  number: number;
  totalElements: number;
  totalPages: number;
};

export type HalCollection<T, R extends string = string, L extends HalLinks = HalLinks> = {
  _embedded: Record<R, T[]>;
  page: HalPageInfo;
  _links: L;
};

export type ProblemFieldError = {
  field: string;
  message: string;
};

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  errors?: ProblemFieldError[];
};

/** Contratos de setores e vínculos usuário↔setor. */
export type CreateSectorInput = {
  nome: string;
  descricao?: string | null;
  organizacaoId?: string | null;
};

export type UpdateSectorInput = Partial<CreateSectorInput>;

export type SectorListQuery = {
  page?: number;
  size?: number;
  search?: string;
  organizacaoId?: string;
};

export type SectorLinks = HalLinks & {
  self: HalLink;
  collection: HalLink;
  update?: HalLink;
  delete?: HalLink;
  users?: HalLink;
};

export type SectorCounts = {
  usuarioSetores: number;
  chamados: number;
};

export type SectorResource = HalResource<SectorLinks> & {
  id: string;
  nome: string;
  descricao: string | null;
  organizacaoId: string | null;
};

export type SectorDetailResource = SectorResource & {
  _count: SectorCounts;
};

export type CreateSectorBindingInput = {
  usuarioId: string;
  setorId: string;
  papelId?: string | null;
};

export type UpdateSectorBindingInput = {
  papelId?: string | null;
};

export type SectorUsersListQuery = {
  page?: number;
  size?: number;
  search?: string;
};

export type UserSectorsListQuery = {
  page?: number;
  size?: number;
};

export type SectorBindingLinks = HalLinks & {
  self: HalLink;
  update?: HalLink;
  delete?: HalLink;
  user?: HalLink;
  sector?: HalLink;
};

export type SectorRoleSummary = {
  id: string;
  nome: string;
  descricao?: string | null;
};

export type SectorMemberUser = {
  id: string;
  nome: string;
  emailPessoal: string | null;
  emailEducacional: string | null;
  ra: string | null;
  papel: Role;
  ativo: boolean;
};

export type SectorBindingResource = HalResource<SectorBindingLinks> & {
  id: string;
  usuarioId: string;
  setorId: string;
  papelId: string | null;
  criadoEm?: string;
  setor?: {
    id: string;
    nome: string;
    descricao: string | null;
    organizacaoId: string | null;
  };
  papel?: SectorRoleSummary | null;
};

export type SectorMemberResource = SectorBindingResource & {
  usuario: SectorMemberUser;
};

export type UserSectorResource = SectorBindingResource;

export type CreatedResource = { id: string };
export type CreatedHttpResource<T extends CreatedResource> = { resource: T; response: Response };

/** Assinaturas compartilhadas dos helpers de Otávio. */
export type CreateTestAppFn = () => Promise<TestAppHandle>;
export type ResetDatabaseFn = (ctx?: Partial<HarnessContext>) => Promise<void>;
export type CreateSetorFn = (
  ctx: TestContext,
  session: TestSession,
  input: CreateSectorInput,
) => Promise<CreatedHttpResource<SectorResource>>;
export type VincularUsuarioAoSetorFn = (
  ctx: TestContext,
  session: TestSession,
  input: CreateSectorBindingInput,
) => Promise<CreatedHttpResource<SectorBindingResource>>;
