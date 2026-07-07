"""
Agenda de Entregas — Flask App
===============================
Calendário de Ordens de Compra com integração SOAP Senior.

Uso:
    pip install -r requirements.txt
    python app.py
"""

import os
import secrets
from flask import Flask, render_template, jsonify, request, session
from soap_service import SeniorSoapService, SoapSettings

app = Flask(__name__)
# Chave secreta para criptografar a sessão (cookies assinados)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
# Cookie seguro: httponly impede acesso via JS, samesite protege contra CSRF
app.config.update(
    SESSION_COOKIE_HTTPONLY = True,
    SESSION_COOKIE_SAMESITE = "Lax",
    PERMANENT_SESSION_LIFETIME = 28800,  # 8 horas
)

SOAP_ENDPOINT = "https://ocweb08s1p.seniorcloud.com.br:30991/g5-senior-services/sapiens_SyncSuply"

# Credenciais de serviço para o portal do fornecedor
# Configure aqui ou via variáveis de ambiente
SUPPLIER_SOAP_USER = os.environ.get("SUPPLIER_SOAP_USER", "agendador")
SUPPLIER_SOAP_PASS = os.environ.get("SUPPLIER_SOAP_PASS", "agendador")

# Instância global para manter debug info entre chamadas
_last_soap = None

def get_soap() -> SeniorSoapService:
    """Cria SoapService com credenciais da sessão do usuário."""
    global _last_soap
    user = session.get("soap_user", "")
    pwd  = session.get("soap_pass", "")
    _last_soap = SeniorSoapService(SoapSettings(
        endpoint   = SOAP_ENDPOINT,
        user       = user,
        password   = pwd,
        encryption = 0,
    ))
    return _last_soap


# ── Páginas ────────────────────────────────────────────────
@app.route("/")
def landing():
    return render_template("landing.html")

@app.route("/agenda")
def agenda():
    return render_template("index.html")

@app.route("/fornecedor")
def fornecedor():
    return render_template("fornecedor.html")

@app.route("/vendas")
def vendas():
    return render_template("vendas.html")


# ── Auth ───────────────────────────────────────────────────
@app.route("/api/login", methods=["POST"])
def login():
    """
    Recebe user/password, valida via SOAP antes de armazenar na sessão.
    """
    data = request.get_json() or {}
    user = data.get("user", "").strip()
    pwd  = data.get("password", "").strip()

    if not user or not pwd:
        return jsonify({"ok": False, "error": "Usuário e senha são obrigatórios."}), 400

    # Testa a conexão ANTES de armazenar na sessão
    test_soap = SeniorSoapService(SoapSettings(
        endpoint   = SOAP_ENDPOINT,
        user       = user,
        password   = pwd,
        encryption = 0,
    ))
    try:
        test_soap.listar_ordens(dat_ini="01/01/2000", dat_fim="01/01/2000")
    except Exception as e:
        err = str(e).lower()
        print(f"  [LOGIN] Exceção para user={user}: {str(e)[:200]}")
        # Erros de dados (sem registros, range vazio) = login ok
        auth_keywords = ['senha', 'password', 'autenticação', 'autenticacao',
                         'permissão', 'permissao', 'acesso negado', 'unauthorized',
                         'usuário', 'usuario', 'credencial', 'login', '401']
        is_auth_error = any(kw in err for kw in auth_keywords)
        if is_auth_error:
            return jsonify({"ok": False, "error": "Usuário ou senha inválidos."}), 401
        # Outros erros (sem dados, timeout) = login ok, credenciais válidas
        print(f"  [LOGIN] Erro não-auth, login aceito: {str(e)[:100]}")

    # Armazena na sessão após validação
    session.permanent = True
    session["soap_user"] = user
    session["soap_pass"] = pwd

    return jsonify({"ok": True, "user": user})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/session", methods=["GET"])
def check_session():
    """Verifica se há sessão ativa."""
    user = session.get("soap_user")
    if user:
        return jsonify({"logged": True, "user": user})
    return jsonify({"logged": False})


# ── API REST ──────────────────────────────────────────────
@app.route("/api/orders", methods=["GET"])
def get_orders():
    if not session.get("soap_user"):
        return jsonify({"error": "Não autenticado."}), 401

    dat_ini = request.args.get("datIni", "")
    dat_fim = request.args.get("datFim", "")
    print(f"  [API] GET /api/orders → datIni={dat_ini!r}  datFim={dat_fim!r}  user={session.get('soap_user')}")

    soap = get_soap()
    try:
        orders = soap.listar_ordens(dat_ini, dat_fim)
        return jsonify([o.to_dict() for o in orders])
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/orders/save", methods=["POST"])
def save_changes():
    if not session.get("soap_user"):
        return jsonify({"error": "Não autenticado."}), 401

    data    = request.get_json() or {}
    changes = data.get("changes", [])
    soap    = get_soap()

    results = []
    for ch in changes:
        oid       = ch.get("orderId", "")
        emp       = ch.get("emp", "")
        fil       = ch.get("fil", "")
        old_date  = ch.get("oldDate", "")
        new_date  = ch.get("newDate", "")
        chave_nfe  = ch.get("chaveNfe", "")
        observacao = ch.get("observacao", "")
        dist_oc    = ch.get("distOC", [])
        print(f"  [SAVE] OC={oid} emp={emp} fil={fil} dtAnt={old_date} dtNew={new_date} chaveNfe={chave_nfe!r} obs={observacao!r} distOC={len(dist_oc)} itens")
        if not oid or not new_date or not old_date:
            results.append({"orderId": oid, "ok": False, "error": "Dados inválidos"})
            continue
        try:
            soap.atualizar_data_entrega(oid, emp, fil, old_date, new_date, chave_nfe, observacao, dist_oc)
            results.append({"orderId": oid, "ok": True})
        except Exception as e:
            results.append({"orderId": oid, "ok": False, "error": str(e)})

    ok_count   = sum(1 for r in results if r["ok"])
    fail_count = sum(1 for r in results if not r["ok"])
    return jsonify({"results": results, "summary": {"ok": ok_count, "failed": fail_count}})

# ── Supplier Portal API ────────────────────────────────────
@app.route("/api/fornecedor/login", methods=["POST"])
def fornecedor_login():
    """
    Login do fornecedor: CPF/CNPJ como usuário, 5 primeiros dígitos como senha.
    """
    data = request.get_json() or {}
    documento = data.get("documento", "").strip()
    senha     = data.get("senha", "").strip()

    # Extrai só dígitos
    doc_digits = ''.join(c for c in documento if c.isdigit())

    if len(doc_digits) < 11:
        return jsonify({"ok": False, "error": "CPF deve ter 11 dígitos ou CNPJ 14 dígitos."}), 400

    # Valida: senha = 5 primeiros dígitos do documento
    expected = doc_digits[:5]
    if senha != expected:
        return jsonify({"ok": False, "error": "Senha incorreta."}), 401

    # Armazena na sessão
    session.permanent = True
    session["fornecedor_doc"] = doc_digits
    session["fornecedor_logged"] = True

    return jsonify({"ok": True, "documento": doc_digits})


@app.route("/api/fornecedor/session", methods=["GET"])
def fornecedor_session():
    if session.get("fornecedor_logged"):
        return jsonify({"logged": True, "documento": session.get("fornecedor_doc", "")})
    return jsonify({"logged": False})


@app.route("/api/fornecedor/logout", methods=["POST"])
def fornecedor_logout():
    session.pop("fornecedor_doc", None)
    session.pop("fornecedor_logged", None)
    return jsonify({"ok": True})


@app.route("/api/fornecedor/buscar", methods=["POST"])
def buscar_fornecedor():
    """Busca ordens abertas do fornecedor logado via SOAP."""
    if not session.get("fornecedor_logged"):
        return jsonify({"error": "Não autenticado."}), 401

    doc_digits = session.get("fornecedor_doc", "").lstrip('0')

    # Credencial de serviço para chamar SOAP
    user = SUPPLIER_SOAP_USER or session.get("soap_user", "")
    pwd  = SUPPLIER_SOAP_PASS or session.get("soap_pass", "")

    if not user:
        return jsonify({"error": "Credenciais de serviço não configuradas. Configure SUPPLIER_SOAP_USER e SUPPLIER_SOAP_PASS."}), 500

    soap = SeniorSoapService(SoapSettings(
        endpoint = SOAP_ENDPOINT, user = user, password = pwd, encryption = 0,
    ))

    try:
        from datetime import datetime
        dat_ini = f"{datetime.today().year}-01-01"
        dat_fim = "2050-12-31"

        print(f"  [FORNECEDOR] Buscando OCs para cgcCpf={doc_digits} de {dat_ini} a {dat_fim}")
        orders = soap.listar_ordens(dat_ini, dat_fim, cgc_cpf=doc_digits)

        # Debug: mostra resposta SOAP
        resp_text = soap.debug.last_response
        print(f"  [FORNECEDOR] Request SOAP:")
        print(f"  {soap.debug.last_request[:800]}")
        print(f"  [FORNECEDOR] Resposta ({len(resp_text)} chars): {resp_text[:1500]}")
        print(f"  [FORNECEDOR] {len(orders)} ordens parseadas")

        return jsonify({"orders": [o.to_dict() for o in orders], "total": len(orders)})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/fornecedor/agendar", methods=["POST"])
def agendar_entrega():
    """
    Recebe agendamento de entrega do fornecedor.
    Por enquanto salva em memória; depois persistirá via webservice.
    """
    data = request.get_json() or {}
    agendamento = {
        "orderId":     data.get("orderId", ""),
        "dataEntrega": data.get("dataEntrega", ""),
        "horaEntrega": data.get("horaEntrega", ""),
        "chaveNfe":    data.get("chaveNfe", ""),
        "nomeMotorista": data.get("nomeMotorista", ""),
        "cpfMotorista":  data.get("cpfMotorista", ""),
        "placaVeiculo":  data.get("placaVeiculo", ""),
        "documento":     data.get("documento", ""),
    }

    # Validações
    if not agendamento["orderId"]:
        return jsonify({"ok": False, "error": "Ordem não informada."}), 400
    if not agendamento["dataEntrega"]:
        return jsonify({"ok": False, "error": "Data de entrega não informada."}), 400

    print(f"  [AGENDAMENTO] OC={agendamento['orderId']} data={agendamento['dataEntrega']} "
          f"hora={agendamento['horaEntrega']} NFe={agendamento['chaveNfe'][:20]}... "
          f"motorista={agendamento['nomeMotorista']} placa={agendamento['placaVeiculo']}")

    # TODO: Persistir via webservice no Senior
    return jsonify({"ok": True, "agendamento": agendamento})


# ── Sales Dashboard API ────────────────────────────────
SALES_ENDPOINT = "https://ocweb08s1p.seniorcloud.com.br:30991/g5-senior-services/sapiens_SyncSales"

@app.route("/api/vendas", methods=["GET"])
def get_vendas():
    if not session.get("soap_user"):
        return jsonify({"error": "Não autenticado."}), 401

    dat_ini = request.args.get("datIni", "")
    dat_fim = request.args.get("datFim", "")
    print(f"  [VENDAS] GET /api/vendas → datIni={dat_ini!r}  datFim={dat_fim!r}")

    soap = SeniorSoapService(SoapSettings(
        endpoint   = SALES_ENDPOINT,
        user       = session.get("soap_user", ""),
        password   = session.get("soap_pass", ""),
        encryption = 0,
    ))

    try:
        dat_ini_br = soap._format_date_br(dat_ini) if dat_ini else ""
        dat_fim_br = soap._format_date_br(dat_fim) if dat_fim else ""
        params = (
            f"<DAT_INI>{dat_ini_br}</DAT_INI>"
            f"<DAT_FIM>{dat_fim_br}</DAT_FIM>"
        )
        xml_text = soap._call("Sales", params)
        # TODO: Parse response when XML format is provided
        return jsonify({"raw": xml_text[:5000], "ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/debug", methods=["GET"])
def get_debug():
    if _last_soap is None:
        return jsonify({"lastRequest":"","lastResponse":"","lastError":"Nenhuma chamada realizada.","lastStatus":0,"lastMs":0})
    d = _last_soap.debug
    return jsonify({
        "lastRequest":  d.last_request,
        "lastResponse": d.last_response,
        "lastError":    d.last_error,
        "lastStatus":   d.last_status,
        "lastMs":       d.last_ms,
    })


# ── Iniciar ────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    print()
    print("  🚚 Agenda de Entregas — Flask + Senior SOAP")
    print("  ──────────────────────────────────────────────")
    print(f"  ✓ Abra no browser: http://localhost:{port}")
    print("  ✓ Ctrl+C para parar")
    print("  ──────────────────────────────────────────────")
    print()
    app.run(host="0.0.0.0", port=port, debug=True)
