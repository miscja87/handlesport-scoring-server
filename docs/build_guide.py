# -*- coding: utf-8 -*-
"""
Genera la guida utente PDF per HandleSport Scoring System.
"""

import os
from PIL import Image as PILImage
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
    PageBreak, ListFlowable, ListItem, Table, TableStyle, KeepTogether, Image
)

OUTPUT_PATH = "HandleSport_Guida_Utente.pdf"
IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")
CONTENT_WIDTH = A4[0] - 2 * 2.2 * cm  # matches leftMargin+rightMargin below


def screenshot(filename, caption=None, max_width=CONTENT_WIDTH):
    """Scaled, framed screenshot Image flowable, with an optional caption."""
    path = os.path.join(IMG_DIR, filename)
    with PILImage.open(path) as im:
        px_w, px_h = im.size
    w = max_width
    h = w * px_h / px_w
    flow = [
        Image(path, width=w, height=h),
    ]
    if caption:
        flow.append(Paragraph(caption, caption_style))
    return KeepTogether(flow)

# ── COLORS ──
NAVY = colors.HexColor("#12233c")
BLUE = colors.HexColor("#1a6fa8")
GREY = colors.HexColor("#5a6472")
DARK_TEXT = colors.HexColor("#1f2937")
LIGHT_BG = colors.HexColor("#f2f4f7")
NOTE_BG = colors.HexColor("#eaf2f8")
WARN_BG = colors.HexColor("#fdecec")
RED = colors.HexColor("#b3212c")
GREEN = colors.HexColor("#1f7a45")
RULE = colors.HexColor("#d8dde5")

# ── STYLES ──
styles = getSampleStyleSheet()

title_style = ParagraphStyle("TitleCustom", parent=styles["Title"], fontName="Helvetica-Bold",
                              fontSize=30, textColor=NAVY, alignment=TA_CENTER, spaceAfter=10)
subtitle_style = ParagraphStyle("SubtitleCustom", parent=styles["Normal"], fontName="Helvetica",
                                 fontSize=14, textColor=GREY, alignment=TA_CENTER, spaceAfter=6)
subtitle2_style = ParagraphStyle("Subtitle2Custom", parent=styles["Normal"], fontName="Helvetica",
                                  fontSize=11, textColor=GREY, alignment=TA_CENTER, spaceAfter=4)

h1_style = ParagraphStyle("H1Custom", parent=styles["Heading1"], fontName="Helvetica-Bold",
                           fontSize=19, textColor=NAVY, spaceBefore=6, spaceAfter=14)
h2_style = ParagraphStyle("H2Custom", parent=styles["Heading2"], fontName="Helvetica-Bold",
                           fontSize=13.5, textColor=BLUE, spaceBefore=16, spaceAfter=8)
h3_style = ParagraphStyle("H3Custom", parent=styles["Heading3"], fontName="Helvetica-Bold",
                           fontSize=11.5, textColor=DARK_TEXT, spaceBefore=10, spaceAfter=6)

body_style = ParagraphStyle("BodyCustom", parent=styles["Normal"], fontName="Helvetica",
                             fontSize=10, leading=14.5, textColor=DARK_TEXT, spaceAfter=7)
bullet_style = ParagraphStyle("BulletCustom", parent=body_style, leftIndent=4, spaceAfter=4)
toc_style = ParagraphStyle("TocCustom", parent=body_style, fontSize=11, leading=20, spaceAfter=2)

note_style = ParagraphStyle("NoteCustom", parent=body_style, backColor=NOTE_BG,
                             borderPadding=(8, 10, 8, 10), leftIndent=0, spaceBefore=4, spaceAfter=10)
warn_style = ParagraphStyle("WarnCustom", parent=body_style, backColor=WARN_BG,
                             borderPadding=(8, 10, 8, 10), leftIndent=0, spaceBefore=4, spaceAfter=10)

label_style = ParagraphStyle("LabelCustom", parent=body_style, fontName="Helvetica-Bold",
                              fontSize=10, textColor=NAVY, spaceAfter=2)
caption_style = ParagraphStyle("CaptionCustom", parent=body_style, fontName="Helvetica-Oblique",
                                fontSize=8.5, textColor=GREY, alignment=TA_CENTER,
                                spaceBefore=4, spaceAfter=14)


def para(text, style=body_style):
    return Paragraph(text, style)


def bullets(items, style=bullet_style):
    return ListFlowable(
        [ListItem(Paragraph(item, style), bulletColor=BLUE) for item in items],
        bulletType="bullet", start="•", leftIndent=14, bulletFontSize=8, spaceBefore=2, spaceAfter=8
    )


def note(text):
    return Paragraph("<font color='#1a6fa8'><b>NOTA — </b></font>" + text, note_style)


def warn(text):
    return Paragraph("<font color='#b3212c'><b>ATTENZIONE — </b></font>" + text, warn_style)


def h1(text):
    return Paragraph(text, h1_style)


def h2(text):
    return Paragraph(text, h2_style)


def h3(text):
    return Paragraph(text, h3_style)


# ── DOC TEMPLATE WITH PDF BOOKMARKS ──
class GuideDocTemplate(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            style_name = flowable.style.name
            text = flowable.getPlainText()
            if style_name == "H1Custom":
                key = "h1-%s" % id(flowable)
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=0, closed=False)
            elif style_name == "H2Custom":
                key = "h2-%s" % id(flowable)
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=1, closed=True)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(2 * cm, 1.6 * cm, A4[0] - 2 * cm, 1.6 * cm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY)
    canvas.drawString(2 * cm, 1.15 * cm, "HandleSport Scoring System — Guida Utente")
    canvas.drawRightString(A4[0] - 2 * cm, 1.15 * cm, "Pagina %d" % doc.page)
    canvas.restoreState()


def title_page_footer(canvas, doc):
    pass  # no header/footer on the cover page


doc = GuideDocTemplate(
    OUTPUT_PATH, pagesize=A4,
    topMargin=2.3 * cm, bottomMargin=2.1 * cm, leftMargin=2.2 * cm, rightMargin=2.2 * cm,
    title="HandleSport Scoring System — Guida Utente"
)
frame_normal = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
frame_cover = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="cover")
doc.addPageTemplates([
    PageTemplate(id="cover", frames=frame_cover, onPage=title_page_footer),
    PageTemplate(id="main", frames=frame_normal, onPage=header_footer),
])

story = []

# ══════════════════════════════════════════════════════════
# COPERTINA
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 6 * cm))
story.append(para("HandleSport", title_style))
story.append(para("Scoring System", ParagraphStyle("t2", parent=title_style, fontSize=20, textColor=BLUE, spaceAfter=30)))
story.append(para("Guida Utente — Pannello Admin", subtitle_style))
story.append(para("Modalità Sparring (SP) e Pattern (PT)", subtitle2_style))
story.append(Spacer(1, 1 * cm))
story.append(para("Versione 1.0", ParagraphStyle("ver", parent=subtitle2_style, fontSize=9, textColor=GREY)))

story.append(Spacer(1, 6 * cm))
story.append(para(
    "Questa guida spiega come utilizzare il pannello di amministrazione per gestire il punteggio "
    "durante gli incontri, sia in modalità Sparring che Pattern, in ambiente LOCAL o GLOBAL.",
    ParagraphStyle("cover-note", parent=body_style, alignment=TA_CENTER, textColor=GREY, fontSize=10)
))

from reportlab.platypus import NextPageTemplate
story.append(NextPageTemplate("main"))  # from here on, use the "main" template (with header/footer)
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# INDICE (semplice, la navigazione reale è nei segnalibri PDF)
# ══════════════════════════════════════════════════════════
story.append(h1("Indice"))
story.append(note(
    "Questo PDF include segnalibri di navigazione: nel tuo lettore PDF apri il pannello "
    "\"Segnalibri\" / \"Sommario\" per saltare direttamente a ogni sezione."
))
toc_entries = [
    "1. Introduzione",
    "2. Accesso e primo avvio",
    "3. Schermata di configurazione (Setup)",
    "4. LOCAL vs GLOBAL",
    "5. Il pannello Admin — elementi comuni",
    "6. Gestione degli arbitri",
    "7. Modalità Sparring (SP)",
    "8. Modalità Pattern (PT)",
    "9. La finestra Display",
    "10. Risoluzione dei problemi",
]
for entry in toc_entries:
    story.append(para(entry, toc_style))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 1. INTRODUZIONE
# ══════════════════════════════════════════════════════════
story.append(h1("1. Introduzione"))
story.append(para(
    "HandleSport Scoring System è l'applicazione usata per gestire il punteggio in tempo reale "
    "degli incontri di combattimento, nelle due specialità <b>SPARRING</b> (SP) e <b>PATTERN</b> (PT). "
    "L'applicazione è composta da tre parti principali:"
))
story.append(bullets([
    "<b>Pannello Admin</b> — la finestra che l'operatore usa per gestire l'incontro (questa guida la descrive nel dettaglio);",
    "<b>Finestra Display</b> — lo schermo pubblico (proiettore, secondo monitor) che mostra il punteggio al pubblico;",
    "<b>Tablet arbitro</b> — l'interfaccia che ogni arbitro usa sul proprio tablet/telefono per inserire i punti.",
]))
story.append(para(
    "L'operatore che gestisce il pannello Admin non deve toccare i tablet degli arbitri: una volta collegati, "
    "gli arbitri assegnano punti autonomamente e l'Admin li riceve automaticamente."
))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 2. ACCESSO E PRIMO AVVIO
# ══════════════════════════════════════════════════════════
story.append(h1("2. Accesso e primo avvio"))
story.append(para(
    "All'avvio dell'applicazione compare la schermata di <b>Login</b>, dove va inserito Username e Password "
    "dell'account HandleSport."
))
story.append(screenshot("shot_login.png", "La schermata di Login.", max_width=8 * cm))
story.append(bullets([
    "Il pulsante <b>LOGIN</b> si abilita solo quando entrambi i campi sono compilati.",
    "Se le credenziali sono corrette, si viene reindirizzati automaticamente alla schermata di configurazione.",
    "La sessione resta salvata: alle successive aperture dell'app il login viene saltato automaticamente.",
]))
story.append(para(
    "Per uscire dall'account e forzare una nuova richiesta di login (ad esempio per usare un altro account), "
    "usare il pulsante <b>Logout</b> in fondo alla schermata di configurazione (Setup)."
))
story.append(warn(
    "In caso di errore di login, il messaggio mostrato aiuta a distinguere una password errata da un "
    "problema di connessione: se l'errore riporta un codice HTTP diverso da \"credenziali non valide\", "
    "il problema è nella connessione al server, non nella password."
))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 3. SCHERMATA DI CONFIGURAZIONE (SETUP)
# ══════════════════════════════════════════════════════════
story.append(h1("3. Schermata di configurazione (Setup)"))
story.append(para(
    "Dopo il login si arriva alla schermata <b>Scoring setup</b>, dove si scelgono i parametri "
    "dell'incontro da gestire, prima di entrare nel pannello Admin vero e proprio."
))
story.append(screenshot("shot_setup.png", "La schermata Scoring setup, con Event, Ring, Mode e Specialty selezionati.", max_width=9 * cm))

story.append(h2("3.1 Indicatore di connessione"))
story.append(para(
    "In alto nella card compare un pallino colorato che indica la stabilità della connessione verso "
    "il backend handlesport.com:"
))
story.append(bullets([
    "<font color='#2a9a5a'>●</font> <b>Verde</b> — connessione stabile;",
    "<font color='#e0b400'>●</font> <b>Giallo</b> — connessione lenta (latenza elevata);",
    "<font color='#cc3340'>●</font> <b>Rosso</b> — connessione instabile (più tentativi falliti di recente).",
]))

story.append(h2("3.2 Event e Ring"))
story.append(para(
    "Selezionare l'evento (<b>Event</b>) e il numero di ring (<b>Ring</b>) su cui si sta gestendo l'incontro. "
    "Se l'account è associato a un evento specifico, la lista mostrerà solo quell'evento."
))

story.append(h2("3.3 Mode — LOCAL o GLOBAL"))
story.append(para(
    "Questa scelta determina come il pannello Admin riceve i punteggi dagli arbitri. Passare il mouse "
    "sull'icona ⓘ accanto a ciascuna opzione per vedere una spiegazione rapida direttamente in app."
))
story.append(bullets([
    "<b>LOCAL</b> (opzione predefinita) — tablet e dispositivi devono essere connessi alla stessa rete locale "
    "di questo computer;",
    "<b>GLOBAL</b> — il punteggio viene gestito interamente tramite Firebase: tablet e dispositivi possono "
    "essere collegati anche a reti diverse (utile quando gli arbitri non possono condividere il Wi-Fi "
    "dell'operatore).",
]))
story.append(note(
    "La sezione 4 di questa guida spiega in dettaglio le differenze pratiche tra le due modalità."
))

story.append(h2("3.4 Specialty"))
story.append(para(
    "Scegliere tra <b>SPARRING</b> e <b>PATTERN</b>: determina quale versione del pannello Admin verrà aperta "
    "(le due modalità hanno layout e funzioni diverse — vedi sezioni 7 e 8)."
))

story.append(h2("3.5 Continue"))
story.append(para(
    "Il pulsante <b>CONTINUE</b> si abilita solo quando Event, Ring, Mode e Specialty sono tutti selezionati. "
    "Cliccandolo si apre il pannello Admin corrispondente."
))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 4. LOCAL vs GLOBAL
# ══════════════════════════════════════════════════════════
story.append(h1("4. LOCAL vs GLOBAL"))
story.append(para(
    "La scelta tra LOCAL e GLOBAL va fatta <b>prima</b> di iniziare l'incontro, sulla schermata di Setup, "
    "e non può essere cambiata a incontro avviato senza tornare indietro."
))

story.append(h2("4.1 Modalità LOCAL"))
story.append(bullets([
    "Tablet e dispositivi degli arbitri devono essere connessi alla <b>stessa rete Wi-Fi/LAN</b> del computer "
    "che esegue l'app Admin.",
    "Il collegamento avviene generando un link/QR code locale dal pannello Admin (vedi sezione 6).",
    "Non richiede una connessione internet stabile durante l'incontro (funziona anche offline sulla rete locale).",
]))

story.append(h2("4.2 Modalità GLOBAL"))
story.append(bullets([
    "Gli arbitri possono trovarsi su <b>reti diverse</b> da quella dell'operatore (es. dati mobili) — il "
    "punteggio passa attraverso Firebase, non è necessario condividere la stessa rete.",
    "Richiede che sia il computer dell'operatore sia i dispositivi degli arbitri abbiano una connessione "
    "internet funzionante.",
    "Compare un badge <b>GLOBAL SYNC</b> in alto nel pannello Admin: verde quando tutto funziona, rosso "
    "lampeggiante se la sincronizzazione con Firebase si interrompe (l'app tenta il ripristino automatico).",
    "In questa modalità sono disponibili anche i pulsanti <b>CLEAR TOKEN</b> (per arbitro) e "
    "<b>CLEAR ALL TOKENS</b> (per tutti) — vedi sezione 6.3.",
]))
story.append(warn(
    "Se il badge \"GLOBAL SYNC\" diventa rosso durante un incontro, i punteggi inviati dagli arbitri "
    "potrebbero non arrivare al pannello Admin fino al ripristino automatico della connessione. "
    "Controllare la connessione internet del computer che esegue l'Admin."
))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 5. IL PANNELLO ADMIN — ELEMENTI COMUNI
# ══════════════════════════════════════════════════════════
story.append(h1("5. Il pannello Admin — elementi comuni"))
story.append(para(
    "Gli elementi descritti in questa sezione sono presenti sia nel pannello Sparring (SP) sia in "
    "quello Pattern (PT)."
))

story.append(h2("5.1 Barra superiore"))
story.append(bullets([
    "<b>RING / Nome evento</b> — indica su quale ring e per quale evento si sta operando;",
    "<b>OPEN DISPLAY</b> — apre/porta in primo piano la finestra Display pubblica (vedi sezione 9);",
    "<b>DOWNLOAD LOG</b> — scarica il log della sessione corrente (utile per rivedere cosa è successo "
    "durante l'incontro o per assistenza tecnica);",
    "<b>CLEAR ALL TOKENS</b> — cancella l'autenticazione di tutti gli arbitri contemporaneamente (vedi "
    "sezione 6.3);",
    "<b>SERIAL</b> — collega una centralina/controller arbitrale via cavo seriale (solo LOCAL), in "
    "alternativa ai tablet;",
    "<b>TEAM SPARRING</b> — attiva la modalità a squadre (solo pannello SP, vedi sezione 7.5).",
]))

story.append(h2("5.2 Caricamento categoria"))
story.append(para(
    "Nella barra sotto il titolo si carica la categoria/incontro da gestire, cliccando su "
    "<b>Load</b> accanto al nome della categoria. Da qui si scorre tra gli incontri della categoria "
    "selezionata."
))

story.append(h2("5.3 Gestione arbitri"))
story.append(para(
    "Ogni arbitro ha una propria \"card\" con i controlli descritti in dettaglio nella sezione 6."
))

story.append(h2("5.4 RESET ALL"))
story.append(para(
    "Il pulsante <b>RESET ALL</b> azzera punteggio, warning/penalità, timer e round, riportando tutto "
    "allo stato iniziale. Richiede sempre una conferma esplicita prima di procedere, per evitare "
    "cancellazioni accidentali."
))
story.append(note(
    "Dopo aver confermato un vincitore (o un pareggio), l'app propone automaticamente di eseguire "
    "RESET ALL in preparazione del prossimo incontro."
))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 6. GESTIONE DEGLI ARBITRI
# ══════════════════════════════════════════════════════════
story.append(h1("6. Gestione degli arbitri"))
story.append(para(
    "Ogni arbitro ha una card dedicata nel pannello Admin, con i seguenti controlli:"
))

story.append(h3("AUTH"))
story.append(para(
    "Genera il link/QR code che l'arbitro deve scansionare con il proprio tablet per collegarsi. "
    "Il QR code e il link testuale compaiono in un popup — l'arbitro scansiona il QR code oppure "
    "riceve/apre il link direttamente."
))

story.append(h3("RESET"))
story.append(para(
    "Azzera il punteggio del singolo arbitro, riportandolo al valore di partenza previsto per la "
    "specialty (0 per Sparring, 10 per Pattern). Non richiede una nuova autenticazione."
))

story.append(h3("CODE / URL"))
story.append(para(
    "Dopo aver generato l'autenticazione (AUTH), questi due pulsanti permettono di copiare rispettivamente "
    "il codice e l'URL negli appunti, utile per inviarli manualmente all'arbitro (es. via chat) invece "
    "di fargli scansionare il QR code."
))

story.append(h3("CLEAR TOKEN"))
story.append(para(
    "Invalida completamente l'autenticazione dell'arbitro: dopo averlo usato, l'arbitro dovrà "
    "scansionare un <b>nuovo</b> QR code (generato con AUTH) per ricollegarsi — il vecchio link smette "
    "di funzionare. Utile se un arbitro ha problemi di connessione persistenti e serve fargli fare "
    "un collegamento pulito da zero. Richiede conferma."
))
story.append(note(
    "Quando un arbitro si collega correttamente, il riquadro del suo punteggio si illumina "
    "(colore acceso) per indicare che è connesso. Se sembra \"spento\", non è ancora collegato."
))

story.append(h2("6.1 Abilitare/disabilitare un arbitro"))
story.append(para(
    "L'interruttore in alto a destra sulla card dell'arbitro permette di escluderlo temporaneamente "
    "dal calcolo del punteggio principale (ad esempio se un arbitro deve assentarsi), senza perdere "
    "il suo collegamento."
))

story.append(h2("6.2 Modifica manuale del punteggio"))
story.append(para(
    "Cliccando direttamente sul numero del punteggio di un arbitro si apre un tastierino numerico "
    "per correggerlo manualmente, utile in caso di errore di inserimento da parte dell'arbitro."
))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 7. MODALITÀ SPARRING (SP)
# ══════════════════════════════════════════════════════════
story.append(h1("7. Modalità Sparring (SP)"))
story.append(screenshot("shot_admin_sp.png", "Il pannello Admin in modalità Sparring, a incontro avviato."))
story.append(PageBreak())

story.append(h2("7.1 Punteggio principale"))
story.append(para(
    "Il punteggio grande al centro (rosso a sinistra, blu a destra) rappresenta il "
    "<b>voto di maggioranza</b>: quanti arbitri, in quel momento, stanno assegnando più punti a "
    "rosso o a blu. Non è la somma dei punti, ma il conteggio degli arbitri a favore di ciascun lato."
))
story.append(para(
    "Sotto ciascun punteggio principale compare l'etichetta con il nome/bandiera del competitor — "
    "cliccando sulla bandiera si apre un selettore per cambiarla."
))

story.append(h2("7.2 Timer e round"))
story.append(bullets([
    "Il pulsante centrale <b>START/STOP</b> avvia e ferma il timer del round;",
    "Al termine del timer, l'app segnala automaticamente la fine del round e propone la pausa (break);",
    "<b>DOCTOR TIMER RED/BLUE</b> — avvia un timer separato per una visita medica su uno dei due "
    "competitor, sospendendo il timer del round.",
]))

story.append(h2("7.3 Warning e Penalty"))
story.append(para(
    "I pulsanti <b>+W</b> (warning) e <b>-P</b> (penalty) registrano ammonizioni e penalità per ciascun "
    "lato; le penalità sottraggono automaticamente un punto al punteggio dell'arbitro coinvolto."
))
story.append(note(
    "Scorciatoie da tastiera (quando il focus è sulla pagina, non su un campo di testo o un popup aperto): "
    "<b>Q</b> = warning rosso, <b>W</b> = warning blu, <b>A</b> = penalty rosso, <b>S</b> = penalty blu."
))

story.append(h2("7.4 Golden Score"))
story.append(para(
    "Il pulsante compatto \"GS\" nella barra in alto (vicino al campo DOCTOR TIMER) attiva la modalità "
    "<b>Golden Score</b>: un mini-timer indipendente dal round normale, usato per gli spareggi. Mentre è "
    "attivo, un badge dorato \"GS\" pulsante compare vicino all'indicatore di stato, ben visibile."
))

story.append(h2("7.5 Team Sparring"))
story.append(para(
    "Attivando <b>TEAM SPARRING</b> dalla barra superiore (richiede conferma), l'incontro passa alla "
    "modalità a squadre: ogni round viene combattuto da un membro diverso della squadra."
))
story.append(bullets([
    "Attivando la modalità, numero di round e durata della pausa vengono impostati automaticamente "
    "(3 round, pausa 10s); disattivandola tornano ai valori di default (1 round, pausa 60s);",
    "Accanto a ciascun punteggio principale compare un piccolo badge con il <b>punteggio cumulativo "
    "di squadra</b>;",
    "Alla fine di ogni round, invece del normale \"fine round\", compare una richiesta di conferma "
    "che somma il risultato del round al punteggio di squadra e resetta punteggio/warning/penalty "
    "per il round successivo (il numero di round e il punteggio di squadra restano invariati);",
    "All'ultimo round, il vincitore viene deciso sul <b>totale cumulativo di squadra</b>, non sul solo "
    "ultimo round;",
    "Un badge verde \"TEAM\" vicino all'indicatore di stato mostra a colpo d'occhio che la modalità è attiva.",
]))

story.append(h2("7.6 Vincitore, pareggio e forzatura risultato"))
story.append(para(
    "Cliccando su uno dei due punteggi principali si apre il popup di conferma vincitore, con i "
    "pulsanti <b>RED WINS</b>, <b>BLUE WINS</b> e <b>TIE</b> (pareggio)."
))
story.append(para(
    "Nello stesso popup, il punteggio mostrato può essere <b>modificato manualmente</b> con i pulsantini "
    "+/- accanto ai numeri — utile in caso di ritiro, infortunio o squalifica, quando il risultato non "
    "corrisponde al conteggio automatico degli arbitri. Se il punteggio viene alterato, compare un "
    "avviso giallo che lo segnala chiaramente prima di confermare."
))
story.append(screenshot("shot_winner_modal.png", "Il popup di conferma vincitore, con RED in vantaggio evidenziato.", max_width=11 * cm))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 8. MODALITÀ PATTERN (PT)
# ══════════════════════════════════════════════════════════
story.append(h1("8. Modalità Pattern (PT)"))
story.append(screenshot("shot_admin_pt.png", "Il pannello Admin in modalità Pattern, con LEVEL 0 e TRAD.SPARRING visibili nella riga centrale."))
story.append(PageBreak())

story.append(h2("8.1 Selezione della forma (pattern)"))
story.append(para(
    "Il pulsante <b>Select Pattern</b> apre la lista delle forme disponibili; è anche possibile far "
    "estrarre casualmente una forma (shuffle) per ciascun competitor."
))
story.append(para(
    "Il nome della forma selezionata compare in un riquadro ben visibile; all'avvio dell'esecuzione, "
    "il nome della forma viene mostrato anche sulla finestra Display per alcuni secondi."
))

story.append(h2("8.2 Punteggio degli arbitri"))
story.append(para(
    "In Pattern il punteggio di ogni arbitro parte da <b>10</b> e scende in base alle penalità "
    "assegnate durante l'esecuzione, invece di salire da zero come in Sparring."
))
story.append(note(
    "I punteggi dei singoli arbitri restano <b>nascosti</b> sulla finestra Display finché l'esecuzione "
    "della forma non è terminata — vengono rivelati tutti insieme a fine forma, per non influenzare "
    "il pubblico durante l'esibizione. Con categorie a due forme, il punteggio totale combinato viene "
    "mostrato solo quando entrambe le forme sono state rivelate."
))

story.append(h2("8.3 LEVEL 0"))
story.append(para(
    "Quando attivo, <b>LEVEL 0</b> fa sì che la prossima pressione di un pulsante da parte di un arbitro "
    "azzeri direttamente il punteggio di quel lato, invece di applicare il normale valore del pulsante. "
    "Va usato solo per penalità molto gravi. È disponibile solo in modalità LOCAL (richiede una "
    "centralina/controller collegata via cavo seriale)."
))

story.append(h2("8.4 TRAD.SPARRING"))
story.append(para(
    "Attivando <b>TRAD.SPARRING</b> (richiede conferma), la casella \"OPTIONAL\" del nome pattern viene "
    "sostituita da un'etichetta dedicata e compare un piccolo cronometro indipendente con i suoi "
    "pulsanti Start/Stop/Reset, per gestire lo sparring tradizionale abbinato alla categoria pattern."
))

story.append(h2("8.5 Vincitore e pareggio"))
story.append(para(
    "Come in Sparring, cliccando sul punteggio principale si apre il popup di conferma con "
    "<b>RED WINS</b>, <b>BLUE WINS</b>, <b>TIE</b> e la possibilità di correggere manualmente il "
    "punteggio prima di confermare (es. in caso di ritiro o squalifica)."
))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 9. LA FINESTRA DISPLAY
# ══════════════════════════════════════════════════════════
story.append(h1("9. La finestra Display"))
story.append(para(
    "Si apre con il pulsante <b>OPEN DISPLAY</b> nella barra superiore del pannello Admin. È pensata "
    "per essere mostrata al pubblico su un proiettore o un secondo monitor."
))
story.append(bullets([
    "Se è collegato un secondo monitor/proiettore, la finestra Display si apre automaticamente a "
    "schermo intero su quello;",
    "Per attivare/disattivare manualmente lo schermo intero, usare il tasto <b>F11</b> (funziona su "
    "Windows) oppure, su Mac, il pulsante verde nella barra del titolo della finestra;",
    "Chiudendo il pannello Admin, la finestra Display si chiude automaticamente insieme ad esso.",
]))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 10. RISOLUZIONE DEI PROBLEMI
# ══════════════════════════════════════════════════════════
story.append(h1("10. Risoluzione dei problemi"))

story.append(h3("Un arbitro non risulta connesso"))
story.append(bullets([
    "Verificare che il riquadro del suo punteggio sia \"acceso\" (colorato) e non spento/grigio;",
    "Rigenerare il collegamento con <b>AUTH</b> e far scansionare di nuovo il QR code;",
    "Se il problema persiste, usare <b>CLEAR TOKEN</b> per quell'arbitro e ripetere l'autenticazione da zero;",
    "In modalità LOCAL, verificare che il dispositivo dell'arbitro sia sulla stessa rete Wi-Fi del computer Admin.",
]))

story.append(h3("Badge \"GLOBAL SYNC LOST\""))
story.append(para(
    "Compare solo in modalità GLOBAL quando il collegamento con il servizio di sincronizzazione si "
    "interrompe. L'app tenta automaticamente di ripristinarlo; se il badge resta rosso per più di "
    "qualche minuto, verificare la connessione internet del computer che esegue l'Admin."
))

story.append(h3("Indicatore di connessione rosso/giallo nella schermata di Setup"))
story.append(para(
    "Indica una connessione lenta o instabile verso il server. Verificare la connessione internet "
    "prima di procedere con un incontro in modalità GLOBAL."
))

story.append(h3("L'arbitro vede un avviso \"offline\" sul proprio tablet"))
story.append(para(
    "Il tablet dell'arbitro mostra un avviso a schermo (e disabilita temporaneamente i pulsanti "
    "punteggio) quando rileva di aver perso la connessione di rete. Basta attendere che la connessione "
    "torni — l'avviso sparisce automaticamente e i pulsanti si riattivano."
))

story.append(h3("Aggiornamenti dell'applicazione"))
story.append(para(
    "All'avvio, l'app verifica automaticamente se è disponibile una versione più recente. In tal caso "
    "compare un popup con il pulsante <b>Download new version</b>, che apre la pagina di download nel "
    "browser predefinito."
))

story.append(h3("L'applicazione non si avvia / rimane bloccata sul caricamento"))
story.append(para(
    "Chiudere completamente l'applicazione (anche dal Task Manager/Gestione attività, se necessario) "
    "e riavviarla. Se il problema persiste, contattare l'assistenza tecnica indicando sistema operativo "
    "(Windows o Mac) e versione dell'app (visibile in alto a destra nella schermata di Setup)."
))

doc.build(story)
print("PDF generato:", OUTPUT_PATH)
