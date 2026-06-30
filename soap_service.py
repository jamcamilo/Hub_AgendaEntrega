"""
Senior SOAP Service — chama o serviço sapiens_SyncSuply.
"""

import re
import xml.etree.ElementTree as ET
from datetime import datetime
from dataclasses import dataclass, field
from time import time
from typing import Optional, List

import requests
# Desabilita warnings de certificado auto-assinado
requests.packages.urllib3.disable_warnings()


@dataclass
class SoapSettings:
    endpoint: str   = "https://ocweb08s1p.seniorcloud.com.br:30991/g5-senior-services/sapiens_SyncSuply"
    user: str       = ""
    password: str   = ""
    encryption: int = 0


@dataclass
class ItemOC:
    cod_emp: str  = ""
    cod_fil: str  = ""
    cod_pro: str  = ""
    des_pro: str  = ""
    num_ocp: str  = ""
    qtd_abe: float = 0.0
    qtd_ped: float = 0.0
    num_doc: str   = ""    # Número da doca
    hor_des: str   = ""    # Horário descarregamento (Oracle minutes)

    def to_dict(self):
        return {
            "codEmp": self.cod_emp,
            "codFil": self.cod_fil,
            "codPro": self.cod_pro,
            "desPro": self.des_pro,
            "numOcp": self.num_ocp,
            "qtdAbe": self.qtd_abe,
            "qtdPed": self.qtd_ped,
            "numDoc": self.num_doc,
            "horDes": self.hor_des,
            "horDesHM": SeniorSoapService._oracle_to_time(self.hor_des),
        }


@dataclass
class PurchaseOrder:
    id: str            = ""
    supplier: str      = ""
    product: str       = ""    # raw concatenated string
    qty: float         = 0.0
    delivery_date: str = ""    # yyyy-MM-dd
    emp: str           = ""
    fil: str           = ""
    tip_mer: str       = ""    # Tipo Mercadoria
    des_ori: str       = ""    # Descrição Origem
    sit_ipo: str       = ""    # Situação: 1=aberta, 2=em andamento, 4=concluída
    nom_usu: str       = ""    # Usuário responsável
    num_nfc: str       = ""    # Número NF
    cod_dep: str       = ""    # Código Depósito
    itens: Optional[List['ItemOC']] = None

    def to_dict(self):
        products = [p.strip() for p in self.product.split("|") if p.strip()]
        return {
            "id":           self.id,
            "supplier":     self.supplier,
            "product":      self.product,
            "products":     products,
            "qty":          self.qty,
            "deliveryDate": self.delivery_date,
            "emp":          self.emp,
            "fil":          self.fil,
            "tipMer":       self.tip_mer,
            "desOri":       self.des_ori,
            "sitIpo":       self.sit_ipo,
            "nomUsu":       self.nom_usu,
            "numNfc":       self.num_nfc,
            "codDep":       self.cod_dep,
            "itens":        [i.to_dict() for i in (self.itens or [])],
        }


@dataclass
class DebugInfo:
    last_request: str   = ""
    last_response: str  = ""
    last_error: str     = ""
    last_status: int    = 0
    last_ms: int        = 0


class SeniorSoapService:
    SOAP_NS = "http://services.senior.com.br"

    def __init__(self, settings: Optional[SoapSettings] = None):
        self.settings = settings or SoapSettings()
        self.debug    = DebugInfo()

    # ── Envelope builder ────────────────────────────────────
    def _envelope(self, action: str, parameters: str = "") -> str:
        s = self.settings
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="{self.SOAP_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <ser:{action}>
      <user>{s.user}</user>
      <password>{s.password}</password>
      <encryption>{s.encryption}</encryption>
      <parameters>
        {parameters}
      </parameters>
    </ser:{action}>
  </soapenv:Body>
</soapenv:Envelope>"""

    # ── Raw SOAP call ───────────────────────────────────────
    def _call(self, action: str, parameters: str = "") -> str:
        envelope = self._envelope(action, parameters)
        self.debug.last_request = envelope
        self.debug.last_error   = ""

        t0 = time()
        try:
            resp = requests.post(
                self.settings.endpoint,
                data=envelope.encode("utf-8"),
                headers={
                    "Content-Type": "text/xml; charset=utf-8",
                    "SOAPAction":   '""',
                },
                verify=False,   # aceita SSL auto-assinado
                timeout=30,
            )
            self.debug.last_ms       = int((time() - t0) * 1000)
            self.debug.last_status   = resp.status_code
            self.debug.last_response = resp.text

            if resp.status_code >= 400:
                self.debug.last_error = f"HTTP {resp.status_code}: {resp.text[:500]}"
                raise Exception(self.debug.last_error)

            if "faultcode" in resp.text.lower() or ":fault" in resp.text.lower():
                m = re.search(r"<faultstring[^>]*>(.*?)</faultstring>", resp.text, re.S | re.I)
                fault = m.group(1).strip() if m else "SOAP Fault"
                self.debug.last_error = fault
                raise Exception(fault)

            # Detecta erroExecucao com conteúdo (ignora tags vazias/self-closing)
            m = re.search(r"<erroExecucao[^/>]*>([^<]+)</erroExecucao>", resp.text, re.S | re.I)
            if m:
                erro = m.group(1).strip()
                if erro:
                    self.debug.last_error = erro
                    raise Exception(erro)

            return resp.text

        except requests.RequestException as e:
            self.debug.last_ms    = int((time() - t0) * 1000)
            self.debug.last_error = f"Erro de conexão: {e}"
            raise

    # ── Parse XML helpers ───────────────────────────────────
    @staticmethod
    def _strip_ns(tag: str) -> str:
        """Remove namespace prefix from tag."""
        return tag.split("}")[-1] if "}" in tag else tag

    @staticmethod
    def _find(el: ET.Element, tag: str) -> str:
        """Find child by local name (ignoring namespace)."""
        for child in el:
            if SeniorSoapService._strip_ns(child.tag) == tag:
                return (child.text or "").strip()
        return ""

    @staticmethod
    def _parse_date(raw: str) -> str:
        """dd/MM/yyyy → yyyy-MM-dd."""
        try:
            return datetime.strptime(raw.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")
        except ValueError:
            return raw.strip()

    @staticmethod
    def _format_date_br(iso: str) -> str:
        """yyyy-MM-dd → dd/MM/yyyy."""
        try:
            return datetime.strptime(iso.strip(), "%Y-%m-%d").strftime("%d/%m/%Y")
        except ValueError:
            return iso.strip()

    @staticmethod
    def _time_to_oracle(time_str: str) -> str:
        """HH:MM → formato Oracle decimal em minutos (4 dígitos).
        Ex: 08:00 → 0480, 08:30 → 0510, 01:00 → 0060, 00:59 → 0059
        """
        if not time_str or ':' not in time_str:
            return time_str or ''
        try:
            parts = time_str.strip().split(':')
            hours = int(parts[0])
            minutes = int(parts[1])
            total = hours * 60 + minutes
            return f"{total:04d}"
        except (ValueError, IndexError):
            return time_str

    @staticmethod
    def _oracle_to_time(oracle_str: str) -> str:
        """Formato Oracle decimal em minutos → HH:MM.
        Ex: 0480 → 08:00, 0510 → 08:30, 0060 → 01:00
        """
        if not oracle_str or oracle_str == '0':
            return ''
        try:
            total = int(oracle_str)
            if total == 0:
                return ''
            hours = total // 60
            minutes = total % 60
            return f"{hours:02d}:{minutes:02d}"
        except (ValueError, TypeError):
            return oracle_str

    # ── Business methods ────────────────────────────────────
    def listar_ordens(self, dat_ini: str = "", dat_fim: str = "", cgc_cpf: str = "0") -> List[PurchaseOrder]:
        """
        dat_ini e dat_fim em yyyy-MM-dd. São convertidos para dd/MM/yyyy para o Senior.
        cgc_cpf: "0" para busca interna (todas), ou número sem zeros à esquerda para fornecedor.
        """
        params = f"<cgcCpf>{cgc_cpf}</cgcCpf>"
        if dat_ini:
            params += f"<datIni>{self._format_date_br(dat_ini)}</datIni>"
        if dat_fim:
            params += f"<datFim>{self._format_date_br(dat_fim)}</datFim>"

        xml_text = self._call("ListarOrdensResponse", params)
        root = ET.fromstring(xml_text)
        orders = []
        for el in root.iter():
            if self._strip_ns(el.tag) == "ordemCompra":
                orders.append(PurchaseOrder(
                    id            = self._find(el, "id"),
                    supplier      = self._find(el, "fornecedor"),
                    product       = self._find(el, "produto"),
                    qty           = float(self._find(el, "quantidade") or 0),
                    delivery_date = self._parse_date(self._find(el, "dataEntrega")),
                    emp           = self._find(el, "emp"),
                    fil           = self._find(el, "fil"),
                    tip_mer       = self._find(el, "tipMer"),
                    des_ori       = self._find(el, "desOri"),
                    sit_ipo       = self._find(el, "sitIpo"),
                    nom_usu       = self._find(el, "nomUsu"),
                    num_nfc       = self._find(el, "numNfc"),
                    cod_dep       = self._find(el, "codDep"),
                    itens         = self._parse_itens(el),
                ))
        return orders

    @staticmethod
    def _parse_itens(el: ET.Element) -> List[ItemOC]:
        """Parse itensOC children from an ordemCompra element."""
        itens = []
        for child in el:
            if SeniorSoapService._strip_ns(child.tag) == "itensOC":
                get = lambda tag: SeniorSoapService._find(child, tag)
                qtd_abe = 0.0
                qtd_ped = 0.0
                try: qtd_abe = float(get("qtdAbe") or 0)
                except: pass
                try: qtd_ped = float(get("qtdPed") or 0)
                except: pass
                itens.append(ItemOC(
                    cod_emp = get("codEmp"),
                    cod_fil = get("codFil"),
                    cod_pro = get("codPro"),
                    des_pro = get("desPro"),
                    num_ocp = get("numOcp"),
                    qtd_abe = qtd_abe,
                    qtd_ped = qtd_ped,
                    num_doc = get("numDoc"),
                    hor_des = get("horDes"),
                ))
        return itens

    def atualizar_data_entrega(self, order_id: str, emp: str, fil: str,
                               dt_ant: str, dt_new: str,
                               chave_nfe: str = "", observacao: str = "",
                               dist_oc: Optional[List[dict]] = None) -> bool:
        """
        Chama ReturnDtEnt para alterar a data de entrega.
        dt_ant e dt_new em yyyy-MM-dd → convertidos para dd/MM/yyyy.
        dist_oc: lista de dicts com { codEmp, codFil, datPrg, numOcp, qtdDis, seqIpo }
        """
        # Monta distOC XML no formato WSDL
        dist_xml = ""
        if dist_oc:
            for d in dist_oc:
                dat_prg = self._format_date_br(d.get("datPrg", ""))
                hor_des = self._time_to_oracle(d.get("horDes", ""))
                dist_xml += (
                    f"<distOC>"
                    f"<codEmp>{d.get('codEmp', emp)}</codEmp>"
                    f"<codFil>{d.get('codFil', fil)}</codFil>"
                    f"<numOcp>{d.get('numOcp', order_id)}</numOcp>"
                    f"<seqIpo>{d.get('seqIpo', '')}</seqIpo>"
                    f"<seqDis>{d.get('seqDis', '')}</seqDis>"
                    f"<qtdDis>{d.get('qtdDis', 0)}</qtdDis>"
                    f"<datPrg>{dat_prg}</datPrg>"
                    f"<numDoc>{d.get('numDoc', '')}</numDoc>"
                    f"<horDes>{hor_des}</horDes>"
                    f"</distOC>"
                )

        params = (
            f"<id>{order_id}</id>"
            f"<emp>{emp}</emp>"
            f"<fil>{fil}</fil>"
            f"<dtAnt>{self._format_date_br(dt_ant)}</dtAnt>"
            f"<dtNew>{self._format_date_br(dt_new)}</dtNew>"
            f"<chaveNfe>{chave_nfe}</chaveNfe>"
            f"<observacao>{observacao}</observacao>"
            f"{dist_xml}"
            f"<flowInstanceID></flowInstanceID>"
            f"<flowName></flowName>"
        )
        print(f"  [SOAP] ReturnDtEnt distOC={'SIM' if dist_xml else 'NÃO'} ({len(dist_oc or [])} linhas)")
        if dist_xml:
            print(f"  [SOAP] DistOC XML: {dist_xml[:500]}")
        self._call("ReturnDtEnt", params)
        return self.debug.last_error == ""
