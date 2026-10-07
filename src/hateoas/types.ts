export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Role = "USUARIO" | "BACKOFFICE" | "TECNICO" | "ADMINISTRADOR";

/** Um link HAL. `method` e `name` são extensões nossas (ver CONVENCOES-API.md, seção 4). */

export interface Link {
    href: string;
    method?: HttpMethod;
    title?: string;
    /** Distingue vários links do mesmo `rel` (ex.: transições de status). */
    name?: string;
}

/** Um `rel` pode ter um link ou vários (array). */

export type Links = Record<string , Link | readonly Link[]>;


export interface Viewer {
    id: string;
    role: Role
}

export type Resource<T> = T & { _links : Links };

export interface PageInfo{
    size: number;
    number: number;
    totalElements: number;
    totalPages: number;
}

export interface Collection<T> {
    _embedded: Record<string, Resource<T>[]>;
    page: PageInfo;
    _links: Links;
}