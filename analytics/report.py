#!/usr/bin/env python3
"""
Relatório de análise de chamados - Fatec Secretaria
=====================================================
Uso:
    python report.py --api-url http://localhost:3000 --email admin@fatec.sp.gov.br --senha Mudar123#
    python report.py --api-url http://localhost:3000 --token <jwt>  --output relatorio.json
"""

import argparse
import json
import sys
import math
from datetime import datetime, timedelta, timezone
from collections import defaultdict

try:
    import httpx
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx"])
    import httpx


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def obter_token(api_url: str, email: str, senha: str) -> str:
    resp = httpx.post(
        f"{api_url}/auth/login",
        json={"email": email, "senha": senha},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("accessToken") or data.get("token")
    if not token:
        raise ValueError(f"Login não retornou accessToken: {data}")
    return token


# ---------------------------------------------------------------------------
# Coleta de dados
# ---------------------------------------------------------------------------

def buscar_stats(api_url: str, token: str) -> dict:
    resp = httpx.get(
        f"{api_url}/tickets/stats",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def buscar_todos_tickets(api_url: str, token: str, page_size: int = 100) -> list[dict]:
    """Pagina todos os chamados do backend."""
    headers = {"Authorization": f"Bearer {token}"}
    page = 1
    todos: list[dict] = []

    while True:
        resp = httpx.get(
            f"{api_url}/tickets",
            params={"page": page, "pageSize": page_size, "include": "setor,responsavel"},
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("items", [])
        todos.extend(items)

        total = data.get("total", 0)
        if len(todos) >= total or not items:
            break
        page += 1

    return todos


# ---------------------------------------------------------------------------
# Análises
# ---------------------------------------------------------------------------

def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def calcular_ttr_horas(chamado: dict) -> float | None:
    criado = parse_iso(chamado.get("criadoEm"))
    enc    = parse_iso(chamado.get("encerradoEm"))
    if criado and enc and enc > criado:
        return (enc - criado).total_seconds() / 3600
    return None


def analise_tempo_resolucao(tickets: list[dict]) -> dict:
    ttrs = [calcular_ttr_horas(t) for t in tickets if calcular_ttr_horas(t) is not None]
    if not ttrs:
        return {"media_h": None, "mediana_h": None, "p90_h": None, "min_h": None, "max_h": None}

    ttrs_sorted = sorted(ttrs)
    n = len(ttrs_sorted)
    media  = sum(ttrs_sorted) / n
    mediana = ttrs_sorted[n // 2]
    p90_idx = math.ceil(n * 0.9) - 1
    p90 = ttrs_sorted[min(p90_idx, n - 1)]

    return {
        "media_h":   round(media,  2),
        "mediana_h": round(mediana, 2),
        "p90_h":     round(p90,    2),
        "min_h":     round(ttrs_sorted[0],  2),
        "max_h":     round(ttrs_sorted[-1], 2),
        "total":     n,
    }


def analise_sla(tickets: list[dict]) -> dict:
    com_sla    = [t for t in tickets if t.get("vencimentoSla") and t.get("encerradoEm")]
    no_prazo   = []
    fora_prazo = []

    for t in com_sla:
        enc  = parse_iso(t["encerradoEm"])
        vcto = parse_iso(t["vencimentoSla"])
        if enc and vcto:
            (no_prazo if enc <= vcto else fora_prazo).append(t)

    total = len(com_sla)
    pct   = round(100 * len(no_prazo) / total, 1) if total else 0

    return {
        "total_com_sla": total,
        "no_prazo":      len(no_prazo),
        "fora_prazo":    len(fora_prazo),
        "pct_no_prazo":  pct,
    }


def analise_volume_por_hora(tickets: list[dict]) -> dict:
    """Distribuição de abertura por hora do dia (identifica pico)."""
    por_hora: dict[int, int] = defaultdict(int)
    for t in tickets:
        dt = parse_iso(t.get("criadoEm"))
        if dt:
            por_hora[dt.hour] += 1

    if not por_hora:
        return {"distribuicao": {}, "hora_pico": None}

    hora_pico = max(por_hora, key=por_hora.__getitem__)
    return {
        "distribuicao": {str(h): c for h, c in sorted(por_hora.items())},
        "hora_pico":    hora_pico,
        "volume_pico":  por_hora[hora_pico],
    }


def analise_backlog(tickets: list[dict]) -> list[dict]:
    """Tickets não resolvidos + idade em dias."""
    abertos = [
        t for t in tickets
        if t.get("status") not in ("RESOLVIDO", "ENCERRADO")
    ]
    agora = datetime.now(timezone.utc)
    resultado = []
    for t in abertos:
        criado = parse_iso(t.get("criadoEm"))
        idade  = round((agora - criado).total_seconds() / 86400, 1) if criado else None
        resultado.append({
            "id":         t.get("id"),
            "protocolo":  t.get("protocolo"),
            "titulo":     t.get("titulo"),
            "status":     t.get("status"),
            "prioridade": t.get("prioridade"),
            "nivel":      t.get("nivel"),
            "setor":      (t.get("setor") or {}).get("nome"),
            "idade_dias": idade,
        })

    return sorted(resultado, key=lambda x: (x.get("idade_dias") or 0), reverse=True)


def detectar_anomalias(tickets: list[dict], ttr_limite_h: float = 120) -> list[dict]:
    """Detecta tickets com TTR muito alto ou urgentes não resolvidos."""
    anomalias = []

    for t in tickets:
        ttr = calcular_ttr_horas(t)
        if ttr and ttr > ttr_limite_h:
            anomalias.append({
                "tipo":      "TTR_ALTO",
                "protocolo": t.get("protocolo"),
                "ttr_horas": round(ttr, 1),
                "setor":     (t.get("setor") or {}).get("nome"),
                "prioridade": t.get("prioridade"),
            })

        status = t.get("status")
        criado = parse_iso(t.get("criadoEm"))
        if (
            t.get("prioridade") == "URGENTE"
            and status not in ("RESOLVIDO", "ENCERRADO")
            and criado
        ):
            idade_h = (datetime.now(timezone.utc) - criado).total_seconds() / 3600
            if idade_h > 24:
                anomalias.append({
                    "tipo":      "URGENTE_NAO_RESOLVIDO",
                    "protocolo": t.get("protocolo"),
                    "idade_horas": round(idade_h, 1),
                    "status":    status,
                    "setor":     (t.get("setor") or {}).get("nome"),
                })

    return anomalias


def gerar_recomendacoes(stats: dict, anomalias: list, backlog: list) -> list[str]:
    recomendacoes = []

    abertos = stats.get("porStatus", {}).get("ABERTO", 0)
    total   = stats.get("total", 1) or 1

    if abertos / total > 0.3:
        recomendacoes.append(
            f"Atenção: {abertos} chamados abertos ({round(100*abertos/total)}% do total). "
            "Considere redistribuir a carga entre equipes."
        )

    ttr = stats.get("ttrMedioHoras", 0)
    if ttr and ttr > 48:
        recomendacoes.append(
            f"Tempo médio de resolução ({ttr:.1f}h) acima de 48h. "
            "Revise o processo de escalonamento N2/N3."
        )

    pct_sla = stats.get("pctNoPrazo", 100)
    if pct_sla < 80:
        recomendacoes.append(
            f"SLA abaixo de 80% (atual: {pct_sla}%). "
            "Revise prazos definidos ou alocacao de equipe."
        )

    urgentes = [a for a in anomalias if a["tipo"] == "URGENTE_NAO_RESOLVIDO"]
    if urgentes:
        recomendacoes.append(
            f"{len(urgentes)} chamado(s) URGENTE(s) sem resolucao ha mais de 24h. Ação imediata recomendada."
        )

    mais_velhos = [b for b in backlog if (b.get("idade_dias") or 0) > 7]
    if mais_velhos:
        recomendacoes.append(
            f"{len(mais_velhos)} chamado(s) aberto(s) com mais de 7 dias sem resolucao."
        )

    if not recomendacoes:
        recomendacoes.append("Operacao dentro dos parâmetros normais. Continue monitorando.")

    return recomendacoes


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Relatório de análise de chamados")
    parser.add_argument("--api-url",  default="http://localhost:3000", help="URL base da API")
    parser.add_argument("--email",    help="E-mail para autenticação")
    parser.add_argument("--senha",    help="Senha para autenticação")
    parser.add_argument("--token",    help="JWT já obtido (dispensa --email/--senha)")
    parser.add_argument("--output",   help="Arquivo de saída JSON (padrão: stdout)")
    parser.add_argument("--ttr-limite", type=float, default=120,
                        help="Limite (horas) para anomalia de TTR alto (padrão: 120)")
    args = parser.parse_args()

    # --- autenticação ---
    if args.token:
        token = args.token
    elif args.email and args.senha:
        print(f"[INFO] Autenticando em {args.api_url}...", file=sys.stderr)
        token = obter_token(args.api_url, args.email, args.senha)
    else:
        parser.error("Informe --token ou (--email + --senha)")

    # --- coleta ---
    print("[INFO] Buscando stats...", file=sys.stderr)
    stats = buscar_stats(args.api_url, token)

    print("[INFO] Buscando todos os tickets (pode demorar)...", file=sys.stderr)
    tickets = buscar_todos_tickets(args.api_url, token)
    print(f"[INFO] {len(tickets)} ticket(s) carregado(s).", file=sys.stderr)

    # --- análises ---
    ttr_analise  = analise_tempo_resolucao(tickets)
    sla_analise  = analise_sla(tickets)
    hora_analise = analise_volume_por_hora(tickets)
    backlog      = analise_backlog(tickets)
    anomalias    = detectar_anomalias(tickets, args.ttr_limite)
    recomendacoes = gerar_recomendacoes(stats, anomalias, backlog)

    # --- montagem do relatório ---
    relatorio = {
        "geradoEm":   datetime.now(timezone.utc).isoformat(),
        "fonte":      args.api_url,
        "resumo":     stats,
        "ttr":        ttr_analise,
        "sla":        sla_analise,
        "volumePorHora": hora_analise,
        "backlog":    backlog[:20],       # top 20 mais antigos
        "anomalias":  anomalias,
        "recomendacoes": recomendacoes,
    }

    # --- output ---
    saida = json.dumps(relatorio, ensure_ascii=False, indent=2)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(saida)
        print(f"[OK] Relatório salvo em {args.output}", file=sys.stderr)
    else:
        print(saida)

    # Imprime resumo no stderr
    print("\n=== RESUMO ===", file=sys.stderr)
    print(f"  Total de chamados : {stats.get('total', 0)}", file=sys.stderr)
    print(f"  Abertos           : {stats.get('porStatus',{}).get('ABERTO',0)}", file=sys.stderr)
    print(f"  TTR médio         : {ttr_analise.get('media_h', 'N/A')} h", file=sys.stderr)
    print(f"  SLA no prazo      : {sla_analise.get('pct_no_prazo', 'N/A')}%", file=sys.stderr)
    print(f"  Anomalias         : {len(anomalias)}", file=sys.stderr)
    for r in recomendacoes:
        print(f"  ⚠️  {r}", file=sys.stderr)


if __name__ == "__main__":
    main()
