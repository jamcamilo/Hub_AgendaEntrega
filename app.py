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


def get_soap() -> SeniorSoapService:
    """Cria SoapService com credenciais da sessão do usuário."""
    user = session.get("soap_user", "")
    pwd  = session.get("soap_pass", "")
    return SeniorSoapService(SoapSettings(
        endpoint   = SOAP_ENDPOINT,
        user       = user,
        password   = pwd,
        encryption = 0,
    ))


# ── Páginas ────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# ── Auth ───────────────────────────────────────────────────
@app.route("/api/login", methods=["POST"])
def login():
    """
    Recebe user/password, armazena na sessão (cookie assinado server-side).
    Faz uma chamada teste ao Senior para validar as credenciais.
    """
    data = request.get_json() or {}
    user = data.get("user", "").strip()
    pwd  = data.get("password", "").strip()

    if not user or not pwd:
        return jsonify({"ok": False, "error": "Usuário e senha são obrigatórios."}), 400

    # Armazena na sessão
    session.permanent = True
    session["soap_user"] = user
    session["soap_pass"] = pwd

    # Testa a conexão com uma chamada mínima
    soap = get_soap()
    try:
        soap.listar_ordens(dat_ini="01/01/2000", dat_fim="01/01/2000")
        return jsonify({"ok": True, "user": user})
    except Exception as e:
        err = str(e)
        # Se o erro for de autenticação, limpa a sessão
        if "senha" in err.lower() or "password" in err.lower() or "autenticação" in err.lower() or "401" in err:
            session.pop("soap_user", None)
            session.pop("soap_pass", None)
            return jsonify({"ok": False, "error": "Usuário ou senha inválidos."}), 401
        # Outros erros (ex: sem dados no range) = login ok, só sem dados
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
        chave_nfe = ch.get("chaveNfe", "")
        observacao = ch.get("observacao", "")
        print(f"  [SAVE] OC={oid} emp={emp} fil={fil} dtAnt={old_date} dtNew={new_date} chaveNfe={chave_nfe!r} obs={observacao!r}")
        if not oid or not new_date or not old_date:
            results.append({"orderId": oid, "ok": False, "error": "Dados inválidos"})
            continue
        try:
            soap.atualizar_data_entrega(oid, emp, fil, old_date, new_date, chave_nfe, observacao)
            results.append({"orderId": oid, "ok": True})
        except Exception as e:
            results.append({"orderId": oid, "ok": False, "error": str(e)})

    ok_count   = sum(1 for r in results if r["ok"])
    fail_count = sum(1 for r in results if not r["ok"])
    return jsonify({"results": results, "summary": {"ok": ok_count, "failed": fail_count}})


@app.route("/api/debug", methods=["GET"])
def get_debug():
    soap = get_soap()
    d = soap.debug
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
    app.run(host="0.0.0.0", port=port, debug=False)
