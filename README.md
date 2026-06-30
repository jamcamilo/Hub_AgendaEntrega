# FreightBoard — Flask + Senior SOAP (Python)

Interface web para gestão visual de Ordens de Compra via SOAP Senior.

## 📋 Pré-requisitos

- **Python 3.10+** (https://www.python.org/downloads/)
  - Verifique com: `python3 --version`

## 🚀 Como rodar

```bash
# 1. Entre na pasta
cd FreightBoardPy

# 2. Instale as dependências
pip3 install -r requirements.txt

# 3. Rode
python3 app.py
```

Acesse: **http://localhost:5000**

## 📁 Estrutura

```
FreightBoardPy/
├── app.py                ← Flask server + rotas API
├── soap_service.py       ← Chamadas SOAP ao Senior
├── requirements.txt      ← flask, requests
├── templates/
│   └── index.html        ← Página principal
└── static/
    ├── css/site.css      ← Estilos
    └── js/app.js         ← Lógica do calendário, drag, pendências
```

## ⚙️ Configuração

Edite as credenciais em `app.py`:

```python
soap = SeniorSoapService(SoapSettings(
    endpoint   = "https://...",
    user       = "seu_usuario",
    password   = "sua_senha",
    encryption = 0,
))
```

## 🔄 API REST interna

| Rota | Método | Descrição |
|------|--------|-----------|
| `/api/orders` | GET | Lista ordens (chama SOAP → JSON) |
| `/api/orders/save` | POST | Salva alterações pendentes |
| `/api/debug` | GET | Última chamada SOAP (debug) |

## ☁️ Deploy no Render

1. Suba este projeto para um repositório no GitHub.
2. No [Render](https://render.com), clique em **New → Web Service** e conecte o repositório.
3. O arquivo `render.yaml` já configura tudo automaticamente (build, start command e `SECRET_KEY`). Se preferir configurar manualmente:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app --bind 0.0.0.0:$PORT`
   - Adicione a variável de ambiente `SECRET_KEY` com um valor aleatório.
4. Clique em **Create Web Service**. Em poucos minutos o app estará no ar em `https://seu-app.onrender.com`.

> No plano gratuito, o serviço "dorme" após 15 min sem tráfego — a próxima requisição leva ~30-60s para acordar.

