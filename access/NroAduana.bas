Option Compare Database
Option Explicit

' ============================================================================
'  Dígito verificador del número de destinación (NroAduana).
'  Misma fórmula que NroAduana_Valido (Rutinas.bas, VB6), sin ADODB ni
'  MsgBox para poder usarla en consultas de Access:
'    SELECT NroAduana FROM Caratula WHERE Not NroAduanaValido(NroAduana);
' ============================================================================

' Letra verificadora para los 15 primeros caracteres del número.
Public Function DigitoVerificadorAduana(ByVal sNro As String) As String
    Dim i As Integer, lSuma As Long, lCodigo As Long, bEsExpo As Boolean
    sNro = UCase(Left(sNro, 15))
    bEsExpo = (InStr(sNro, "MANE") = 5)
    If bEsExpo Then sNro = Replace(sNro, "MANE", "MANI")
    For i = 1 To 15
        lSuma = lSuma + Asc(Mid(sNro, i, 1))
    Next i
    lCodigo = (lSuma Mod 23) + 65
    If bEsExpo Then lCodigo = lCodigo + 1
    Select Case lCodigo
        Case 73: lCodigo = 88   ' I -> X
        Case 79: lCodigo = 89   ' O -> Y
        Case 81: lCodigo = 90   ' Q -> Z
        Case 91: lCodigo = 65   ' desborde -> A
    End Select
    DigitoVerificadorAduana = Chr(lCodigo)
End Function

' True si el número tiene el formato correcto y la letra que corresponde.
' Acepta Null (devuelve False) para usarla en consultas sin errores.
Public Function NroAduanaValido(ByVal vNro As Variant) As Boolean
    Dim s As String
    If IsNull(vNro) Then Exit Function
    s = UCase(Trim(vNro))
    If Len(s) <> 16 Then Exit Function
    If Not IsNumeric(Left(s, 2)) Or Not IsNumeric(Mid(s, 3, 3)) Or Not IsNumeric(Mid(s, 10, 6)) Then Exit Function
    NroAduanaValido = (DigitoVerificadorAduana(s) = Mid(s, 16, 1))
End Function
