import { RouteGenericInterface } from "fastify";


export type GetUserQuery = {
  id?: string;
  ra?: string;
  email?: string;
  educationalEmail?: string;
  name?: string; 
  cursoSigla?: string;
  cursoNome?: string;
};

export interface GetUserRoute extends RouteGenericInterface {
  Querystring: GetUserQuery;
}
