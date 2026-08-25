# 🚚 Agenda de Entregas

Interface web para gestão de Ordens de Compra integrada ao ERP Senior via SOAP.

## 🖥️ Rodar localmente

```bash
cd FreightBoardPy
pip install -r requirements.txt
python app.py
```
Acesse: http://localhost:3000

## ☁️ Deploy no Render (gratuito)

### Passo 1 — Subir no GitHub

```bash
cd FreightBoardPy
git init
git add .
git commit -m "Agenda de Entregas v1"
```

Crie um repositório no GitHub e faça push:

```bash
git remote add origin https://github.com/SEU_USUARIO/agenda-entregas.git
git branch -M main
git push -u origin main
```

### Passo 2 — Criar no Render

1. Acesse https://render.com e crie conta (grátis, sem cartão)
2. Clique **New → Web Service**
3. Conecte sua conta GitHub e selecione o repositório
4. Configure:
   - **Name:** `agenda-entregas`
   - **Runtime:** `Python`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
5. Em **Environment Variables**, adicione:
   - `SECRET_KEY` → clique Generate
   - `SUPPLIER_SOAP_USER` → `agendador`
   - `SUPPLIER_SOAP_PASS` → `agendador`
6. Clique **Create Web Service**

Pronto! URL tipo: `https://agenda-entregas.onrender.com`

### Deploy automático

Cada `git push` no GitHub faz deploy automático no Render.

## 📁 Estrutura

```
FreightBoardPy/
├── app.py                ← Flask server + rotas API
├── soap_service.py       ← Chamadas SOAP ao Senior
├── requirements.txt      ← flask, requests, gunicorn
├── render.yaml           ← Blueprint do Render
├── templates/
│   ├── landing.html      ← Página inicial (escolha Agenda/Fornecedor)
│   ├── index.html        ← Calendário interno (agenda)
│   └── fornecedor.html   ← Portal do fornecedor
└── static/
    ├── css/site.css      ← Estilos
    └── js/app.js         ← Lógica do calendário, drag, pendências
```

## ⚙️ Variáveis de ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `SECRET_KEY` | Chave para sessão Flask | Gerada automaticamente |
| `SUPPLIER_SOAP_USER` | Usuário SOAP para portal fornecedor | `agendador` |
| `SUPPLIER_SOAP_PASS` | Senha SOAP para portal fornecedor | `agendador` |
| `PORT` | Porta HTTP (Render define automaticamente) | `3000` |
