let call,
  vmRef,
  vmIp,
  host = window.location.host

function _call(method, params) {
  console.log(`-> ${method}(${JSON.stringify(params)})`)
  return window
    .fetch(`http://${host}/jsonrpc`, {
      body: JSON.stringify({
        id: 0,
        jsonrpc: '2.0',
        method,
        params
      }),
      method: 'POST',
      headers: new Headers({
        Accept: 'application/json',
        'Content-Type': 'application/json'
      })
    })
    .then(res => {
      if (!res.ok) {
        throw res.status
      }
      return res.json().then(json => {
        if (json.result !== undefined) {
          console.log(`<- ${JSON.stringify(json.result)}`)
          return json.result
        }
        console.error(`<x ${JSON.stringify(json.error)}`)
        throw json.error
      })
    })
    .catch(error => {
      if (error && error.message === 'HOST_IS_SLAVE') {
        console.log(
          'Host is slave, changing host to master',
          error.data[0]
        )
        host = error.data[0]
        return _call(method, params)
      }
      throw error
    })
}

function connect() {
  $('#connect fieldset').attr('disabled', true)
  _call('session.login_with_password', [
    'root',
    $('#pwd').val(),
    '2.3',
    'XOA deploy'
  ])
    .then(sessionRef => {
      call = (method, ...params) =>
        _call(method, [sessionRef].concat(params))
    })
    .then(() => call('SR.get_all_records'))
    .then(srs => {
      $('#connect').css({ display: 'none' })
      $('#config').css({ display: 'block' })
      const select = $('#srs')
      let sr
      Object.keys(srs).forEach(srRef => {
        sr = srs[srRef]
        if (sr.content_type !== 'iso' && sr.physical_size > 0) {
          select.append(
            $('<option/>')
              .val(srRef)
              .text(
                `${sr.name_label} - ${Math.round(
                  (sr.physical_size - sr.physical_utilisation) /
                    Math.pow(1024, 3)
                )} GiB left`
              )
          )
        }
      })
    })
    .catch(error => {
      alert(JSON.stringify(error, null, 2))
    })
}

function deploy() {
  const status = text => $('#deploy').text(text)
  const srRef = $('#srs').val()
  status('Deploying XOA...')
  $('#config fieldset').attr('disabled', true)
  call(
    'VM.import',
    'http://xoa.io:8888/',
    srRef,
    false, // full_restore
    false // force
  )
    .then(([_vmRef]) => {
      vmRef = _vmRef
      status('Configuring XOA...')
      const promises = []
      const ip = $('#ip').val()
      if (ip) {
        promises.push(
          call('VM.add_to_xenstore_data', vmRef, 'vm-data/ip', ip),
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/netmask',
            $('#netmask').val() || '255.255.255.0'
          ),
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/gateway',
            $('#gateway').val() || ''
          ),
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/dns',
            $('#dns').val() || '8.8.8.8'
          )
        )
      }
      const email = $('#adminEmail').val()
      const password = $('#adminPwd').val()
      if (email && password) {
        promises.push(
          call(
            'VM.add_to_xenstore_data',
            vmRef,
            'vm-data/admin-account',
            JSON.stringify({ email, password })
          )
        )
      }
      promises.push(
        call(
          'VM.add_to_xenstore_data',
          vmRef,
          'vm-data/xenservers',
          JSON.stringify([host])
        )
      )
      console.log('promises', promises)
      return Promise.all(promises)
    })
    .then(() => {
      console.log('Starting XOA')
      status('Starting XOA...')
      return call(
        'VM.start',
        vmRef,
        false, // start_paused
        false // force
      )
    })
    .then(() => call('VM.get_guest_metrics', vmRef))
    .then(metricsRef => {
      status('Almost there...')
      let attempts = 60
      const waitForIp = () => {
        return call('VM_guest_metrics.get_networks', metricsRef).then(
          networks => {
            if (networks && networks['0/ip'] !== undefined) {
              return networks['0/ip']
            }
            if (attempts-- === 0) {
              throw 'XOA not responding'
            }
            return new Promise((resolve, reject) =>
              setTimeout(() => waitForIp().then(resolve, reject), 1e3)
            )
          }
        )
      }
      return waitForIp()
    })
    .then(ip => {
      vmIp = ip
      return Promise.all([
        call('VM.remove_from_xenstore_data', vmRef, 'vm-data/ip'),
        call('VM.remove_from_xenstore_data', vmRef, 'vm-data/netmask'),
        call('VM.remove_from_xenstore_data', vmRef, 'vm-data/gateway'),
        call('VM.remove_from_xenstore_data', vmRef, 'vm-data/dns'),
        call(
          'VM.remove_from_xenstore_data',
          vmRef,
          'vm-data/admin-account'
        ),
        call('VM.remove_from_xenstore_data', vmRef, 'vm-data/xenservers')
      ])
    })
    .then(() => {
      status('XOA is ready! Redirecting...')
      setTimeout(() => {
        window.location = `http://${$('#ip').val() || vmIp}`
      }, 3e3)
    })
    .catch(error => {
      alert(JSON.stringify(error), null, 2)
    })
}
