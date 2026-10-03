Option Compare Database
Option Explicit

' ============================================================================
'  Completa la corrección de Estadisticas.mdb (versión del 03/10, tipos ya corregidos).
'  Los porqué están en docs/DECISIONES.md.
'  ANTES DE EJECUTAR: hacer una copia del .mdb y cerrar todas las tablas.
'  Uso: importar este módulo
'  (Alt+F11 > Archivo > Importar archivo) y ejecutar CorregirEstadisticas (F5).
'  Se puede volver a ejecutar: cada paso verifica si ya se hizo.
' ============================================================================

Private Const REL_SIN_INTEGRIDAD As Long = 2 ' dbRelationDontEnforce
Private Const REL_CASCADA_ACT As Long = 256  ' dbRelationUpdateCascade
Private Const REL_CASCADA_BORR As Long = 4096 ' dbRelationDeleteCascade

Public Sub CorregirEstadisticas()
    Dim db As DAO.Database
    Set db = CurrentDb

    ' 1. Relaciones: Item-Liq está sólo por idOperacion (le falta Item), las
    '    del KIT están invertidas y falta DIVISAS. Se borran y se rehacen al final.
    BorrarRelacionesDe db, "Caratula"
    BorrarRelacionesDe db, "Item"
    BorrarRelacionesDe db, "Liq"

    ' 2. Periodo como Entero largo: Entero llega a 32.767 y 202608 no entra.
    db.Execute "ALTER TABLE Caratula ALTER COLUMN Periodo LONG", dbFailOnError

    ' 3. NroAduana con índice único: sin él se puede cargar dos veces la misma
    '    destinación, y buscar por número recorre toda la tabla.
    If Not ExisteIndice(db, "Caratula", "NroAduana") Then
        db.Execute "CREATE UNIQUE INDEX NroAduana ON Caratula (NroAduana)", dbFailOnError
    End If

    ' 4. Índices que repiten el comienzo de la clave primaria (sobran).
    BorrarIndiceSiNoEsClave db, "Caratula", "idOperacion"
    BorrarIndiceSiNoEsClave db, "Item", "idOperacion"

    ' 5. Clave de Liq en el orden de la relación con Item:
    '    (idOperacion, Item, Codigo). Así el mismo índice sirve para el join
    '    y el índice suelto de idOperacion deja de hacer falta.
    BorrarClavePrimaria db, "Liq"
    BorrarIndiceSiNoEsClave db, "Liq", "idOperacion"
    db.Execute "CREATE INDEX PrimaryKey ON [Liq] (idOperacion, [Item], Codigo) WITH PRIMARY", dbFailOnError

    ' 6. Relaciones.
    '    Caratula -> Item -> Liq: uno a varios con integridad y cascada
    '    (borrar una carátula borra sus ítems y su liquidación).
    CrearRelacion db, "CaratulaItem", "Caratula", "Item", _
        Array("idOperacion"), Array("idOperacion"), REL_CASCADA_ACT + REL_CASCADA_BORR
    CrearRelacion db, "ItemLiq", "Item", "Liq", _
        Array("idOperacion", "Item"), Array("idOperacion", "Item"), REL_CASCADA_ACT + REL_CASCADA_BORR

    '    Tablas del KIT (vinculadas): el lado "uno" es la tabla del KIT.
    '    Sin integridad: Access no puede exigirla entre bases distintas.
    CrearRelacion db, "ADUANASCaratula", "ADUANAS", "Caratula", Array("Codigo"), Array("AduanaOficializacion"), REL_SIN_INTEGRIDAD
    CrearRelacion db, "DESTINACIONESCaratula", "DESTINACIONES", "Caratula", Array("Codigo"), Array("Destinacion"), REL_SIN_INTEGRIDAD
    CrearRelacion db, "VIACaratula", "VIA", "Caratula", Array("Codigo"), Array("Via"), REL_SIN_INTEGRIDAD
    CrearRelacion db, "PAISESCaratula", "PAISES", "Caratula", Array("Codigo"), Array("PaisProcedencia"), REL_SIN_INTEGRIDAD
    CrearRelacion db, "DIVISASCaratula", "DIVISAS", "Caratula", Array("Codigo"), Array("DivisaFOB"), REL_SIN_INTEGRIDAD
    CrearRelacion db, "PAISESItem", "PAISES", "Item", Array("Codigo"), Array("PaisOrigen"), REL_SIN_INTEGRIDAD
    CrearRelacion db, "UNIDADESMEDIDAItem", "UNIDADESMEDIDA", "Item", Array("Codigo"), Array("Unidadmedida"), REL_SIN_INTEGRIDAD
    CrearRelacion db, "POSICIONItem", "POSICION", "Item", Array("PosicionSIM"), Array("PosicionSIM"), REL_SIN_INTEGRIDAD
    CrearRelacion db, "TASASLiq", "TASAS", "Liq", Array("Codigo"), Array("Codigo"), REL_SIN_INTEGRIDAD

    MsgBox "Estadisticas.mdb corregida. Revisar la ventana Inmediato (Ctrl+G) por avisos.", vbInformation
End Sub

' ---------------------------------------------------------------------------
Private Sub BorrarRelacionesDe(db As DAO.Database, tabla As String)
    Dim i As Integer
    For i = db.Relations.Count - 1 To 0 Step -1
        With db.Relations(i)
            If .Table = tabla Or .ForeignTable = tabla Then
                Debug.Print "Relación borrada: " & .Name & " (" & .Table & " -> " & .ForeignTable & ")"
                db.Relations.Delete .Name
            End If
        End With
    Next i
End Sub

Private Sub CrearRelacion(db As DAO.Database, nombre As String, tablaUno As String, _
                          tablaVarios As String, camposUno As Variant, camposVarios As Variant, _
                          atributos As Long)
    Dim rel As DAO.Relation, fld As DAO.Field, i As Integer
    On Error GoTo Fallo
    Set rel = db.CreateRelation(nombre, tablaUno, tablaVarios, atributos)
    For i = LBound(camposUno) To UBound(camposUno)
        Set fld = rel.CreateField(camposUno(i))
        fld.ForeignName = camposVarios(i)
        rel.Fields.Append fld
    Next i
    db.Relations.Append rel
    Exit Sub
Fallo:
    Debug.Print "Aviso: no se pudo crear " & nombre & " (" & Err.Description & "). Crearla a mano en Relaciones."
End Sub

Private Sub BorrarClavePrimaria(db As DAO.Database, tabla As String)
    Dim ix As DAO.Index
    For Each ix In db.TableDefs(tabla).Indexes
        If ix.Primary Then
            db.Execute "DROP INDEX [" & ix.Name & "] ON [" & tabla & "]", dbFailOnError
            Exit Sub
        End If
    Next ix
End Sub

Private Sub BorrarIndiceSiNoEsClave(db As DAO.Database, tabla As String, indice As String)
    Dim ix As DAO.Index
    For Each ix In db.TableDefs(tabla).Indexes
        If ix.Name = indice And Not ix.Primary Then
            db.Execute "DROP INDEX [" & indice & "] ON [" & tabla & "]", dbFailOnError
            Exit Sub
        End If
    Next ix
End Sub

Private Function ExisteIndice(db As DAO.Database, tabla As String, indice As String) As Boolean
    Dim ix As DAO.Index
    For Each ix In db.TableDefs(tabla).Indexes
        If ix.Name = indice Then ExisteIndice = True: Exit Function
    Next ix
End Function
